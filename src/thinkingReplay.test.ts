import assert from "assert/strict";

import type { AnthropicMessage } from "./anthropic/anthropicTypes";
import type { OpenAIChatMessage } from "./openai/openaiTypes";
import { resolveReasoningDialectProfile } from "./reasoningDialect";
import {
	applyAnthropicThinkingReplay,
	applyThinkingReplay,
	buildThinkingReplayMissError,
	decideThinkingReplayRequest,
} from "./thinkingReplay";
import {
	buildOpenAIReplayHistoryKey,
	MemoryThinkingReplayStorage,
	type StoredReplayCarrier,
	ThinkingReplayStore,
} from "./thinkingReplayStore";
import type { ModelTransport } from "./types";

async function storeWithEntries(
	entries: Array<{
		modelId: string;
		callId: string;
		reasoningContent?: string;
		reasoningSignature?: string;
		redactedThinkingData?: string;
		observedWithoutReplayPayload?: boolean;
		profileId?: string;
		transport?: ModelTransport;
		carrier?: StoredReplayCarrier;
	}>
) {
	const store = new ThinkingReplayStore();
	await store.initialize(new MemoryThinkingReplayStorage());
	for (const entry of entries) {
		const turn =
			entry.profileId && entry.transport && entry.carrier
				? store.beginTurn({
						modelId: entry.modelId,
						profileId: entry.profileId,
						transport: entry.transport,
						carrier: entry.carrier,
					})
				: store.beginTurn(entry.modelId);
		if (entry.reasoningContent) {
			store.appendReasoning(turn.turnId, entry.reasoningContent);
		}
		if (entry.reasoningSignature) {
			store.appendReasoningSignature(turn.turnId, entry.reasoningSignature);
		}
		if (entry.redactedThinkingData) {
			store.appendRedactedThinkingData(turn.turnId, entry.redactedThinkingData);
		}
		if (entry.observedWithoutReplayPayload) {
			store.markObservedWithoutReplayPayload(turn.turnId);
		}
		store.recordToolCall(turn.turnId, entry.callId);
		await store.commit(turn.turnId);
	}
	return store;
}

async function storeOrdinaryAssistantTurn(input: {
	modelId: string;
	history: OpenAIChatMessage[];
	content: string;
	reasoningContent?: string;
	allowsMissingReplayPayload?: boolean;
}) {
	const store = new ThinkingReplayStore();
	await store.initialize(new MemoryThinkingReplayStorage());
	const profile = resolveReasoningDialectProfile({ modelId: input.modelId, transport: "openai" });
	const turn = store.beginTurn({
		modelId: input.modelId,
		profileId: profile.id,
		transport: profile.transport,
		carrier: "reasoning_content",
		historyKey: buildOpenAIReplayHistoryKey(input.history),
		captureAssistantMessages: true,
		allowsMissingReplayPayload: input.allowsMissingReplayPayload ?? false,
	});
	if (input.reasoningContent) {
		store.appendReasoning(turn.turnId, input.reasoningContent);
	}
	store.appendAssistantContent(turn.turnId, input.content);
	await store.commit(turn.turnId);
	return store;
}

describe("applyThinkingReplay", () => {
	it("injects matching reasoning_content without mutating the original messages", async () => {
		const store = await storeWithEntries([
			{ modelId: "mimo-v2.5-pro", callId: "call_1", reasoningContent: "stored reasoning" },
		]);
		const messages: OpenAIChatMessage[] = [
			{ role: "user", content: "hello" },
			{
				role: "assistant",
				content: undefined,
				tool_calls: [{ id: "call_1", type: "function", function: { name: "read_file", arguments: "{}" } }],
			},
			{ role: "tool", tool_call_id: "call_1", content: "result" },
		];

		const result = applyThinkingReplay({ modelId: "mimo-v2.5-pro", messages, store });

		assert.equal(result.allRequiredReasoningReplayed, true);
		assert.equal(result.hasAssistantToolCalls, true);
		assert.equal(result.replayedCount, 1);
		assert.deepEqual(result.missingCallIds, []);
		assert.equal(result.messages[1].reasoning_content, "stored reasoning");
		assert.equal(messages[1].reasoning_content, undefined);
		assert.notEqual(result.messages[1], messages[1]);
	});

	it("accepts multiple tool calls on one assistant message when they share the same reasoning", async () => {
		const store = await storeWithEntries([
			{ modelId: "mimo-v2.5-pro", callId: "call_1", reasoningContent: "same reasoning" },
			{ modelId: "mimo-v2.5-pro", callId: "call_2", reasoningContent: "same reasoning" },
		]);
		const messages: OpenAIChatMessage[] = [
			{
				role: "assistant",
				tool_calls: [
					{ id: "call_1", type: "function", function: { name: "a", arguments: "{}" } },
					{ id: "call_2", type: "function", function: { name: "b", arguments: "{}" } },
				],
			},
		];

		const result = applyThinkingReplay({ modelId: "mimo-v2.5-pro", messages, store });

		assert.equal(result.allRequiredReasoningReplayed, true);
		assert.equal(result.replayedCount, 1);
		assert.equal(result.messages[0].reasoning_content, "same reasoning");
	});

	it("treats mixed GLM-5.2 reasoning and observed-empty tool turns as complete history", async () => {
		const profile = resolveReasoningDialectProfile({ modelId: "glm-5.2", transport: "openai" });
		const store = await storeWithEntries([
			{
				modelId: "glm-5.2",
				callId: "call_reasoned",
				reasoningContent: "stored reasoning",
				profileId: profile.id,
				transport: profile.transport,
				carrier: "reasoning_content",
			},
			{
				modelId: "glm-5.2",
				callId: "call_observed_empty",
				observedWithoutReplayPayload: true,
				profileId: profile.id,
				transport: profile.transport,
				carrier: "reasoning_content",
			},
		]);
		const messages: OpenAIChatMessage[] = [
			{
				role: "assistant",
				tool_calls: [{ id: "call_reasoned", type: "function", function: { name: "first_tool", arguments: "{}" } }],
			},
			{ role: "tool", tool_call_id: "call_reasoned", content: "first result" },
			{
				role: "assistant",
				tool_calls: [
					{
						id: "call_observed_empty",
						type: "function",
						function: { name: "second_tool", arguments: "{}" },
					},
				],
			},
			{ role: "tool", tool_call_id: "call_observed_empty", content: "second result" },
		];

		const result = applyThinkingReplay({ modelId: "glm-5.2", profile, messages, store });
		const decision = decideThinkingReplayRequest({
			userOptedIntoRoundTrip: true,
			allowMissingReplay: true,
			resetThinkingHistoryOnReplayGap: profile.resetThinkingHistoryOnReplayGap,
			preflight: result,
		});

		assert.equal(result.allRequiredReasoningReplayed, true);
		assert.equal(result.replayedCount, 1);
		assert.equal(result.observedWithoutReplayPayloadCount, 1);
		assert.deepEqual(result.missingCallIds, []);
		assert.deepEqual(result.conflictingCallIds, []);
		assert.equal(result.messages[0].reasoning_content, "stored reasoning");
		assert.equal(result.messages[2].reasoning_content, undefined);
		assert.equal(decision.allowThinkingRoundTrip, true);
		assert.equal(decision.resetThinkingHistory, undefined);
	});

	it("marks missing tool call ids and missing store entries as unreplayable", async () => {
		const store = await storeWithEntries([]);
		const messages: OpenAIChatMessage[] = [
			{
				role: "assistant",
				tool_calls: [
					{ id: "", type: "function", function: { name: "missing_id", arguments: "{}" } },
					{ id: "call_missing", type: "function", function: { name: "missing_store", arguments: "{}" } },
				],
			},
		];

		const result = applyThinkingReplay({ modelId: "mimo-v2.5-pro", messages, store });

		assert.equal(result.allRequiredReasoningReplayed, false);
		assert.deepEqual(result.missingCallIds, ["<missing>", "call_missing"]);
		assert.equal(result.messages[0].reasoning_content, undefined);
	});

	it("marks one assistant message with conflicting reasoning entries as unreplayable", async () => {
		const store = await storeWithEntries([
			{ modelId: "mimo-v2.5-pro", callId: "call_1", reasoningContent: "first" },
			{ modelId: "mimo-v2.5-pro", callId: "call_2", reasoningContent: "second" },
		]);
		const messages: OpenAIChatMessage[] = [
			{
				role: "assistant",
				tool_calls: [
					{ id: "call_1", type: "function", function: { name: "a", arguments: "{}" } },
					{ id: "call_2", type: "function", function: { name: "b", arguments: "{}" } },
				],
			},
		];

		const result = applyThinkingReplay({ modelId: "mimo-v2.5-pro", messages, store });

		assert.equal(result.allRequiredReasoningReplayed, false);
		assert.deepEqual(result.conflictingCallIds, ["call_1", "call_2"]);
		assert.equal(result.messages[0].reasoning_content, undefined);
	});

	it("leaves non-tool and already-reasoned messages replay-safe", async () => {
		const store = await storeWithEntries([]);
		const messages: OpenAIChatMessage[] = [
			{ role: "assistant", content: "plain text" },
			{
				role: "assistant",
				reasoning_content: "host supplied",
				tool_calls: [{ id: "call_host", type: "function", function: { name: "a", arguments: "{}" } }],
			},
		];

		const result = applyThinkingReplay({ modelId: "mimo-v2.5-pro", messages, store });

		assert.equal(result.allRequiredReasoningReplayed, true);
		assert.equal(result.hasAssistantToolCalls, true);
		assert.equal(result.replayedCount, 0);
		assert.equal(result.messages[1].reasoning_content, "host supplied");
	});

	it("replays ordinary K3 assistant turns from transcript fingerprints", async () => {
		const history: OpenAIChatMessage[] = [{ role: "user", content: "First question" }];
		const store = await storeOrdinaryAssistantTurn({
			modelId: "kimi-k3",
			history,
			content: "First answer",
			reasoningContent: "first hidden reasoning",
		});
		const profile = resolveReasoningDialectProfile({ modelId: "kimi-k3", transport: "openai" });
		const messages: OpenAIChatMessage[] = [
			...history,
			{ role: "assistant", content: "First answer" },
			{ role: "user", content: "Follow up" },
		];

		const result = applyThinkingReplay({ modelId: "kimi-k3", profile, messages, store });

		assert.equal(result.allRequiredReasoningReplayed, true);
		assert.equal(result.hasAssistantToolCalls, false);
		assert.equal(result.hasAssistantMessagesRequiringReplay, true);
		assert.equal(result.replayedCount, 1);
		assert.deepEqual(result.missingAssistantMessageIndexes, []);
		assert.equal(result.messages[1].reasoning_content, "first hidden reasoning");
		assert.equal(messages[1].reasoning_content, undefined);
	});

	it("marks an uncached ordinary K3 assistant turn as a strict replay miss", async () => {
		const profile = resolveReasoningDialectProfile({ modelId: "kimi-k3", transport: "openai" });
		const messages: OpenAIChatMessage[] = [
			{ role: "user", content: "First question" },
			{ role: "assistant", content: "Uncached answer" },
			{ role: "user", content: "Follow up" },
		];

		const result = applyThinkingReplay({
			modelId: "kimi-k3",
			profile,
			messages,
			store: await storeWithEntries([]),
		});

		assert.equal(result.allRequiredReasoningReplayed, false);
		assert.equal(result.hasAssistantToolCalls, false);
		assert.equal(result.hasAssistantMessagesRequiringReplay, true);
		assert.deepEqual(result.missingAssistantMessageIndexes, [1]);
	});

	it("accepts ordinary K3 turns observed without a reasoning payload", async () => {
		const history: OpenAIChatMessage[] = [{ role: "user", content: "First question" }];
		const store = await storeOrdinaryAssistantTurn({
			modelId: "kimi-k3",
			history,
			content: "Answer without reasoning",
			allowsMissingReplayPayload: true,
		});
		const profile = resolveReasoningDialectProfile({ modelId: "kimi-k3", transport: "openai" });
		const messages: OpenAIChatMessage[] = [
			...history,
			{ role: "assistant", content: "Answer without reasoning" },
			{ role: "user", content: "Follow up" },
		];

		const result = applyThinkingReplay({ modelId: "kimi-k3", profile, messages, store });

		assert.equal(result.allRequiredReasoningReplayed, true);
		assert.equal(result.replayedCount, 0);
		assert.deepEqual(result.missingAssistantMessageIndexes, []);
		assert.equal(result.messages[1].reasoning_content, undefined);
	});

	it("accepts K2.6 assistant turns captured while thinking was disabled", async () => {
		const history: OpenAIChatMessage[] = [{ role: "user", content: "First question" }];
		const store = await storeOrdinaryAssistantTurn({
			modelId: "kimi-k2.6",
			history,
			content: "Answer produced with thinking disabled",
			allowsMissingReplayPayload: true,
		});
		const profile = resolveReasoningDialectProfile({ modelId: "kimi-k2.6", transport: "openai" });
		const messages: OpenAIChatMessage[] = [
			...history,
			{ role: "assistant", content: "Answer produced with thinking disabled" },
			{ role: "user", content: "Continue with thinking enabled" },
		];

		const result = applyThinkingReplay({ modelId: "kimi-k2.6", profile, messages, store });

		assert.equal(result.allRequiredReasoningReplayed, true);
		assert.equal(result.hasAssistantMessagesRequiringReplay, true);
		assert.equal(result.replayedCount, 0);
		assert.deepEqual(result.missingAssistantMessageIndexes, []);
	});

	it("does not require ordinary assistant replay for Kimi K2.5", async () => {
		const profile = resolveReasoningDialectProfile({ modelId: "kimi-k2.5", transport: "openai" });
		const messages: OpenAIChatMessage[] = [
			{ role: "user", content: "First question" },
			{ role: "assistant", content: "Plain prior answer" },
			{ role: "user", content: "Follow up" },
		];

		const result = applyThinkingReplay({
			modelId: "kimi-k2.5",
			profile,
			messages,
			store: await storeWithEntries([]),
		});

		assert.equal(result.allRequiredReasoningReplayed, true);
		assert.equal(result.hasAssistantMessagesRequiringReplay, false);
		assert.deepEqual(result.missingAssistantMessageIndexes, []);
	});

	it("injects matching reasoning_details for MiniMax split-mode profiles", async () => {
		const store = new ThinkingReplayStore();
		await store.initialize(new MemoryThinkingReplayStorage());
		const profile = resolveReasoningDialectProfile({ modelId: "minimax-m2.7", transport: "openai" });
		const turn = store.beginTurn({
			modelId: "minimax-m2.7",
			profileId: profile.id,
			transport: profile.transport,
			carrier: "reasoning_details",
		});
		store.appendReasoningDetails(turn.turnId, [
			{ type: "reasoning.text", text: "stored detail", format: "minimax", id: "r1" },
		]);
		store.recordToolCall(turn.turnId, "call_1");
		await store.commit(turn.turnId);
		const messages: OpenAIChatMessage[] = [
			{
				role: "assistant",
				tool_calls: [{ id: "call_1", type: "function", function: { name: "read_file", arguments: "{}" } }],
			},
		];

		const result = applyThinkingReplay({ modelId: "minimax-m2.7", profile, messages, store });

		assert.equal(result.allRequiredReasoningReplayed, true);
		assert.equal(result.replayedCount, 1);
		assert.deepEqual(result.messages[0].reasoning_details, [
			{ type: "reasoning.text", text: "stored detail", format: "minimax", id: "r1" },
		]);
		assert.equal(result.messages[0].reasoning_content, undefined);
	});

	it("rejects wrong-carrier replay entries instead of injecting reasoning_content into MiniMax split mode", async () => {
		const store = await storeWithEntries([
			{ modelId: "minimax-m2.7", callId: "call_1", reasoningContent: "wrong carrier" },
		]);
		const profile = resolveReasoningDialectProfile({ modelId: "minimax-m2.7", transport: "openai" });
		const messages: OpenAIChatMessage[] = [
			{
				role: "assistant",
				tool_calls: [{ id: "call_1", type: "function", function: { name: "read_file", arguments: "{}" } }],
			},
		];

		const result = applyThinkingReplay({ modelId: "minimax-m2.7", profile, messages, store });

		assert.equal(result.allRequiredReasoningReplayed, false);
		assert.deepEqual(result.missingCallIds, ["call_1"]);
		assert.equal(result.messages[0].reasoning_content, undefined);
		assert.equal(result.messages[0].reasoning_details, undefined);
	});
});

describe("applyAnthropicThinkingReplay", () => {
	it("injects matching thinking blocks before Anthropic tool_use blocks", async () => {
		const store = await storeWithEntries([
			{
				modelId: "mimo-v2.5-pro",
				callId: "toolu_1",
				reasoningContent: "stored thinking",
				reasoningSignature: "sig_1",
			},
		]);
		const messages: AnthropicMessage[] = [
			{ role: "user", content: [{ type: "text", text: "hello" }] },
			{
				role: "assistant",
				content: [
					{ type: "text", text: "I will inspect that." },
					{ type: "tool_use", id: "toolu_1", name: "read_file", input: {} },
				],
			},
			{ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "result" }] },
		];

		const result = applyAnthropicThinkingReplay({ modelId: "mimo-v2.5-pro", messages, store });

		assert.equal(result.allRequiredReasoningReplayed, true);
		assert.equal(result.hasAssistantToolCalls, true);
		assert.equal(result.replayedCount, 1);
		assert.deepEqual(result.missingCallIds, []);
		assert.deepEqual((result.messages[1].content as unknown[])[1], {
			type: "thinking",
			thinking: "stored thinking",
			signature: "sig_1",
		});
		assert.deepEqual((messages[1].content as unknown[])[1], {
			type: "tool_use",
			id: "toolu_1",
			name: "read_file",
			input: {},
		});
		assert.notEqual(result.messages[1], messages[1]);
	});

	it("marks missing Anthropic tool_use replay entries as unreplayable", async () => {
		const store = await storeWithEntries([]);
		const messages: AnthropicMessage[] = [
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "toolu_missing", name: "read_file", input: {} }],
			},
		];

		const result = applyAnthropicThinkingReplay({ modelId: "mimo-v2.5-pro", messages, store });

		assert.equal(result.allRequiredReasoningReplayed, false);
		assert.deepEqual(result.missingCallIds, ["toolu_missing"]);
		assert.deepEqual(result.messages[0].content, messages[0].content);
	});

	it("leaves observed no-payload Anthropic tool turns replay-safe", async () => {
		const store = await storeWithEntries([
			{
				modelId: "claude-opus-4-6",
				callId: "toolu_no_thinking",
				observedWithoutReplayPayload: true,
				profileId: "claude-anthropic-adaptive-thinking",
				transport: "anthropic",
				carrier: "anthropic_thinking_block",
			},
		]);
		const profile = resolveReasoningDialectProfile({
			modelId: "claude-opus-4-6",
			transport: "anthropic",
		});
		const messages: AnthropicMessage[] = [
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "toolu_no_thinking", name: "read_file", input: {} }],
			},
		];

		const result = applyAnthropicThinkingReplay({ modelId: "claude-opus-4-6", profile, messages, store });

		assert.equal(result.allRequiredReasoningReplayed, true);
		assert.equal(result.hasAssistantToolCalls, true);
		assert.equal(result.replayedCount, 0);
		assert.deepEqual(result.missingCallIds, []);
		assert.deepEqual(result.messages[0].content, messages[0].content);
	});

	it("injects matching redacted thinking blocks before Anthropic tool_use blocks", async () => {
		const store = await storeWithEntries([
			{
				modelId: "claude-opus-4-6",
				callId: "toolu_redacted",
				redactedThinkingData: "encrypted_thinking_blob",
			},
		]);
		const messages: AnthropicMessage[] = [
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "toolu_redacted", name: "read_file", input: {} }],
			},
		];

		const result = applyAnthropicThinkingReplay({ modelId: "claude-opus-4-6", messages, store });

		assert.equal(result.allRequiredReasoningReplayed, true);
		assert.equal(result.replayedCount, 1);
		assert.deepEqual((result.messages[0].content as unknown[])[0], {
			type: "redacted_thinking",
			data: "encrypted_thinking_blob",
		});
		assert.deepEqual((result.messages[0].content as unknown[])[1], {
			type: "tool_use",
			id: "toolu_redacted",
			name: "read_file",
			input: {},
		});
	});

	it("leaves existing Anthropic thinking blocks replay-safe", async () => {
		const store = await storeWithEntries([]);
		const messages: AnthropicMessage[] = [
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "host supplied", signature: "sig_host" },
					{ type: "tool_use", id: "toolu_host", name: "read_file", input: {} },
				],
			},
		];

		const result = applyAnthropicThinkingReplay({ modelId: "mimo-v2.5-pro", messages, store });

		assert.equal(result.allRequiredReasoningReplayed, true);
		assert.equal(result.hasAssistantToolCalls, true);
		assert.equal(result.replayedCount, 0);
		assert.deepEqual(result.messages[0].content, messages[0].content);
	});

	it("leaves existing Anthropic redacted thinking blocks replay-safe", async () => {
		const store = await storeWithEntries([]);
		const messages: AnthropicMessage[] = [
			{
				role: "assistant",
				content: [
					{ type: "redacted_thinking", data: "host encrypted" },
					{ type: "tool_use", id: "toolu_host", name: "read_file", input: {} },
				],
			},
		];

		const result = applyAnthropicThinkingReplay({ modelId: "claude-opus-4-6", messages, store });

		assert.equal(result.allRequiredReasoningReplayed, true);
		assert.equal(result.hasAssistantToolCalls, true);
		assert.equal(result.replayedCount, 0);
		assert.deepEqual(result.messages[0].content, messages[0].content);
	});
});

describe("decideThinkingReplayRequest", () => {
	it("allows opted-in new chats and full replay hits", async () => {
		const empty = applyThinkingReplay({
			modelId: "mimo-v2.5-pro",
			messages: [{ role: "user", content: "hello" }],
			store: await storeWithEntries([]),
		});
		assert.deepEqual(decideThinkingReplayRequest({ userOptedIntoRoundTrip: true, preflight: empty }), {
			allowThinkingRoundTrip: true,
			failLocalReason: undefined,
		});

		const hit = applyThinkingReplay({
			modelId: "mimo-v2.5-pro",
			messages: [
				{
					role: "assistant",
					tool_calls: [{ id: "call_1", type: "function", function: { name: "a", arguments: "{}" } }],
				},
			],
			store: await storeWithEntries([{ modelId: "mimo-v2.5-pro", callId: "call_1", reasoningContent: "stored" }]),
		});
		assert.deepEqual(decideThinkingReplayRequest({ userOptedIntoRoundTrip: true, preflight: hit }), {
			allowThinkingRoundTrip: true,
			failLocalReason: undefined,
		});
	});

	it("fails locally for opted-in replay misses but not for non-opted requests", async () => {
		const miss = applyThinkingReplay({
			modelId: "mimo-v2.5-pro",
			messages: [
				{
					role: "assistant",
					tool_calls: [{ id: "call_missing", type: "function", function: { name: "a", arguments: "{}" } }],
				},
			],
			store: await storeWithEntries([]),
		});

		assert.equal(
			decideThinkingReplayRequest({ userOptedIntoRoundTrip: true, preflight: miss }).failLocalReason?.includes(
				"Reasoning cannot be resumed"
			),
			true
		);
		assert.equal(
			decideThinkingReplayRequest({ userOptedIntoRoundTrip: false, preflight: miss }).failLocalReason,
			undefined
		);
		assert.equal(
			decideThinkingReplayRequest({ userOptedIntoRoundTrip: false, preflight: miss }).allowThinkingRoundTrip,
			false
		);
	});

	it("allows opted-in best-effort profiles to continue when compacted tool-call reasoning is absent", async () => {
		const profile = resolveReasoningDialectProfile({ modelId: "glm-5.1", transport: "openai" });
		const miss = applyThinkingReplay({
			modelId: "glm-5.1",
			profile,
			messages: [
				{
					role: "assistant",
					tool_calls: [{ id: "call_missing", type: "function", function: { name: "a", arguments: "{}" } }],
				},
			],
			store: await storeWithEntries([]),
		});

		const decision = decideThinkingReplayRequest({
			userOptedIntoRoundTrip: true,
			preflight: miss,
			allowMissingReplay: true,
		});

		assert.equal(decision.allowThinkingRoundTrip, true);
		assert.equal(decision.failLocalReason, undefined);
	});

	it("resets GLM-5.2 thinking history for true replay gaps instead of partially preserving it", async () => {
		const profile = resolveReasoningDialectProfile({ modelId: "glm-5.2", transport: "openai" });
		const originalMessages: OpenAIChatMessage[] = [
			{
				role: "assistant",
				tool_calls: [{ id: "call_replayed", type: "function", function: { name: "first_tool", arguments: "{}" } }],
			},
			{ role: "tool", tool_call_id: "call_replayed", content: "first result" },
			{
				role: "assistant",
				tool_calls: [{ id: "call_missing", type: "function", function: { name: "second_tool", arguments: "{}" } }],
			},
		];
		const preflight = applyThinkingReplay({
			modelId: "glm-5.2",
			profile,
			messages: originalMessages,
			store: await storeWithEntries([
				{
					modelId: "glm-5.2",
					callId: "call_replayed",
					reasoningContent: "do not send this during reset",
					profileId: profile.id,
					transport: profile.transport,
					carrier: "reasoning_content",
				},
			]),
		});

		const decision = decideThinkingReplayRequest({
			userOptedIntoRoundTrip: true,
			allowMissingReplay: true,
			resetThinkingHistoryOnReplayGap: profile.resetThinkingHistoryOnReplayGap,
			preflight,
		});

		assert.equal(preflight.replayedCount, 1);
		assert.deepEqual(preflight.missingCallIds, ["call_missing"]);
		assert.equal(preflight.messages[0].reasoning_content, "do not send this during reset");
		assert.equal(originalMessages[0].reasoning_content, undefined);
		assert.deepEqual(decision, {
			allowThinkingRoundTrip: true,
			failLocalReason: undefined,
			resetThinkingHistory: true,
			resetReason: "missing",
		});
	});

	it("resets GLM-5.2 thinking history when one assistant tool-call turn has conflicting replay", async () => {
		const profile = resolveReasoningDialectProfile({ modelId: "glm-5.2", transport: "openai" });
		const preflight = applyThinkingReplay({
			modelId: "glm-5.2",
			profile,
			messages: [
				{
					role: "assistant",
					tool_calls: [
						{ id: "call_1", type: "function", function: { name: "first_tool", arguments: "{}" } },
						{ id: "call_2", type: "function", function: { name: "second_tool", arguments: "{}" } },
					],
				},
			],
			store: await storeWithEntries([
				{
					modelId: "glm-5.2",
					callId: "call_1",
					reasoningContent: "first reasoning",
					profileId: profile.id,
					transport: profile.transport,
					carrier: "reasoning_content",
				},
				{
					modelId: "glm-5.2",
					callId: "call_2",
					reasoningContent: "different reasoning",
					profileId: profile.id,
					transport: profile.transport,
					carrier: "reasoning_content",
				},
			]),
		});

		const decision = decideThinkingReplayRequest({
			userOptedIntoRoundTrip: true,
			allowMissingReplay: true,
			resetThinkingHistoryOnReplayGap: profile.resetThinkingHistoryOnReplayGap,
			preflight,
		});

		assert.deepEqual(preflight.conflictingCallIds, ["call_1", "call_2"]);
		assert.equal(decision.resetThinkingHistory, true);
		assert.equal(decision.resetReason, "conflict");
	});

	it("fails locally for replay-required profiles even without explicit opt-in", async () => {
		const miss = applyThinkingReplay({
			modelId: "glm-5.1",
			messages: [
				{
					role: "assistant",
					tool_calls: [{ id: "call_missing", type: "function", function: { name: "a", arguments: "{}" } }],
				},
			],
			store: await storeWithEntries([]),
		});

		const decision = decideThinkingReplayRequest({
			userOptedIntoRoundTrip: false,
			replayRequiredByProfile: true,
			preflight: miss,
			failureContext: {
				modelId: "glm-5.1",
				transport: "openai",
				profileId: "glm-5-default-thinking",
				carrier: "reasoning_content",
			},
		});

		assert.equal(decision.allowThinkingRoundTrip, false);
		assert.equal(decision.failLocalReason?.includes("Reasoning cannot be resumed"), true);
		assert.equal(decision.failLocalReason?.includes("model=glm-5.1"), true);
		assert.equal(decision.failLocalReason?.includes("transport=openai"), true);
		assert.equal(decision.failLocalReason?.includes("carrier=reasoning_content"), true);
		assert.equal(decision.failLocalReason?.includes("missingToolCallIds=call_missing"), true);
	});

	it("fails locally when forced-preserved K3 ordinary history cannot be replayed", async () => {
		const profile = resolveReasoningDialectProfile({ modelId: "kimi-k3", transport: "openai" });
		const miss = applyThinkingReplay({
			modelId: "kimi-k3",
			profile,
			messages: [
				{ role: "user", content: "First question" },
				{ role: "assistant", content: "Uncached answer" },
				{ role: "user", content: "Follow up" },
			],
			store: await storeWithEntries([]),
		});

		const decision = decideThinkingReplayRequest({
			userOptedIntoRoundTrip: false,
			replayRequiredByProfile: true,
			preflight: miss,
			failureContext: {
				modelId: "kimi-k3",
				transport: "openai",
				profileId: profile.id,
				carrier: "reasoning_content",
			},
		});

		assert.equal(decision.allowThinkingRoundTrip, false);
		assert.match(decision.failLocalReason ?? "", /missingAssistantMessageIndexes=1/);
	});

	it("requires replay for DeepSeek R1 forced reasoning profiles without exposing a toggle", async () => {
		const profile = resolveReasoningDialectProfile({ modelId: "deepseek-r1", transport: "openai" });
		const empty = applyThinkingReplay({
			modelId: "deepseek-r1",
			profile,
			messages: [{ role: "user", content: "hello" }],
			store: await storeWithEntries([]),
		});

		assert.deepEqual(
			decideThinkingReplayRequest({
				userOptedIntoRoundTrip: false,
				replayRequiredByProfile: profile.defaultThinking === "forced",
				preflight: empty,
			}),
			{ allowThinkingRoundTrip: true, failLocalReason: undefined }
		);

		const miss = applyThinkingReplay({
			modelId: "deepseek-r1",
			profile,
			messages: [
				{
					role: "assistant",
					tool_calls: [{ id: "call_missing", type: "function", function: { name: "a", arguments: "{}" } }],
				},
			],
			store: await storeWithEntries([]),
		});
		const decision = decideThinkingReplayRequest({
			userOptedIntoRoundTrip: false,
			replayRequiredByProfile: profile.defaultThinking === "forced",
			preflight: miss,
			failureContext: {
				modelId: "deepseek-r1",
				transport: profile.transport,
				profileId: profile.id,
				carrier: "reasoning_content",
			},
		});

		assert.equal(decision.allowThinkingRoundTrip, false);
		assert.equal(decision.failLocalReason?.includes("model=deepseek-r1"), true);
		assert.equal(decision.failLocalReason?.includes("profile=deepseek-r1-forced-reasoning"), true);
		assert.equal(decision.failLocalReason?.includes("carrier=reasoning_content"), true);
		assert.equal(decision.failLocalReason?.includes("missingToolCallIds=call_missing"), true);
	});

	it("formats replay-miss diagnostics without dumping unlimited tool call ids", () => {
		const error = buildThinkingReplayMissError(
			{
				messages: [],
				allRequiredReasoningReplayed: false,
				hasAssistantToolCalls: true,
				hasAssistantMessagesRequiringReplay: true,
				replayedCount: 0,
				observedWithoutReplayPayloadCount: 0,
				missingCallIds: ["call_1", "call_2", "call_3", "call_4", "call_5", "call_6"],
				conflictingCallIds: [],
				missingAssistantMessageIndexes: [],
				conflictingAssistantMessageIndexes: [],
			},
			{
				modelId: "glm-5.1",
				transport: "openai",
				profileId: "glm-5-default-thinking",
				carrier: "reasoning_content",
			}
		);

		assert.match(error, /model=glm-5\.1/);
		assert.match(error, /profile=glm-5-default-thinking/);
		assert.match(error, /missingToolCallIds=call_1,call_2,call_3,call_4,call_5,\+1 more/);
	});

	it("allows automatic round-trip capture for replay-required new chats", async () => {
		const empty = applyThinkingReplay({
			modelId: "glm-5.1",
			messages: [{ role: "user", content: "hello" }],
			store: await storeWithEntries([]),
		});

		assert.deepEqual(
			decideThinkingReplayRequest({
				userOptedIntoRoundTrip: false,
				replayRequiredByProfile: true,
				preflight: empty,
			}),
			{
				allowThinkingRoundTrip: true,
				failLocalReason: undefined,
			}
		);
	});
});
