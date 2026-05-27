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
import { MemoryThinkingReplayStorage, ThinkingReplayStore } from "./thinkingReplayStore";

async function storeWithEntries(
	entries: Array<{ modelId: string; callId: string; reasoningContent: string; reasoningSignature?: string }>
) {
	const store = new ThinkingReplayStore();
	await store.initialize(new MemoryThinkingReplayStorage());
	for (const entry of entries) {
		const turn = store.beginTurn(entry.modelId);
		store.appendReasoning(turn.turnId, entry.reasoningContent);
		if (entry.reasoningSignature) {
			store.appendReasoningSignature(turn.turnId, entry.reasoningSignature);
		}
		store.recordToolCall(turn.turnId, entry.callId);
		await store.commit(turn.turnId);
	}
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

	it("formats replay-miss diagnostics without dumping unlimited tool call ids", () => {
		const error = buildThinkingReplayMissError(
			{
				messages: [],
				allRequiredReasoningReplayed: false,
				hasAssistantToolCalls: true,
				replayedCount: 0,
				missingCallIds: ["call_1", "call_2", "call_3", "call_4", "call_5", "call_6"],
				conflictingCallIds: [],
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
