import assert from "assert/strict";

import type { OpenAIChatMessage } from "./openai/openaiTypes";
import { applyThinkingReplay, decideThinkingReplayRequest } from "./thinkingReplay";
import { MemoryThinkingReplayStorage, ThinkingReplayStore } from "./thinkingReplayStore";

async function storeWithEntries(entries: Array<{ modelId: string; callId: string; reasoningContent: string }>) {
	const store = new ThinkingReplayStore();
	await store.initialize(new MemoryThinkingReplayStorage());
	for (const entry of entries) {
		const turn = store.beginTurn(entry.modelId);
		store.appendReasoning(turn.turnId, entry.reasoningContent);
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
			store: await storeWithEntries([
				{ modelId: "mimo-v2.5-pro", callId: "call_1", reasoningContent: "stored" },
			]),
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
		assert.equal(decideThinkingReplayRequest({ userOptedIntoRoundTrip: false, preflight: miss }).allowThinkingRoundTrip, false);
	});
});
