import assert from "assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import {
	buildOpenAIAssistantReplayKey,
	buildOpenAIReplayHistoryKey,
	LocalJsonlThinkingReplayStorage,
	LocalPlaintextThinkingReplayStorage,
	MemoryThinkingReplayStorage,
	ThinkingReplayStore,
} from "./thinkingReplayStore";

describe("ThinkingReplayStore", () => {
	it("commits and looks up exact reasoning content by model and tool call id", async () => {
		const store = new ThinkingReplayStore();
		await store.initialize(new MemoryThinkingReplayStorage());

		const turn = store.beginTurn("mimo-v2.5-pro");
		store.appendReasoning(turn.turnId, "reason ");
		store.appendReasoning(turn.turnId, "content");
		store.recordToolCall(turn.turnId, "call_1");

		await store.commit(turn.turnId);

		const entry = store.lookup("mimo-v2.5-pro", "call_1");
		assert.equal(entry?.reasoningContent, "reason content");
		assert.equal(entry?.modelId, "mimo-v2.5-pro");
		assert.deepEqual(entry?.callIds, ["call_1"]);
	});

	it("records completed GLM-5.2 tool turns that contain no reasoning payload", async () => {
		const store = new ThinkingReplayStore();
		await store.initialize(new MemoryThinkingReplayStorage());
		const turn = store.beginTurn({
			modelId: "glm-5.2",
			profileId: "glm-5.2-openai",
			transport: "openai",
			carrier: "reasoning_content",
			allowsMissingReplayPayload: true,
		});
		store.recordToolCall(turn.turnId, "call_without_reasoning");

		await store.commit(turn.turnId);

		const entry = store.lookup({
			modelId: "glm-5.2",
			callId: "call_without_reasoning",
			profileId: "glm-5.2-openai",
			carrier: "reasoning_content",
		});
		assert.equal(entry?.observedWithoutReplayPayload, true);
		assert.equal(entry?.reasoningContent, undefined);
	});

	it("stores ordinary assistant reasoning by transcript fingerprint", async () => {
		const store = new ThinkingReplayStore();
		await store.initialize(new MemoryThinkingReplayStorage());
		const history = [{ role: "user" as const, content: "Continue the proof." }];
		const historyKey = buildOpenAIReplayHistoryKey(history);
		const turn = store.beginTurn({
			modelId: "kimi-k3",
			profileId: "kimi-k3-forced-preserved",
			transport: "openai",
			carrier: "reasoning_content",
			historyKey,
			captureAssistantMessages: true,
			allowsMissingReplayPayload: true,
		});
		store.appendReasoning(turn.turnId, "hidden reasoning");
		store.appendAssistantContent(turn.turnId, "Final");
		store.appendAssistantContent(turn.turnId, " answer");
		await store.commit(turn.turnId);

		const assistantMessageKey = buildOpenAIAssistantReplayKey(historyKey, {
			role: "assistant",
			content: "Final   answer",
		});
		const entry = store.lookupAssistant({
			modelId: "kimi-k3",
			assistantMessageKey,
			profileId: "kimi-k3-forced-preserved",
			carrier: "reasoning_content",
		});

		assert.equal(entry?.reasoningContent, "hidden reasoning");
		assert.equal(entry?.callId, undefined);
		assert.equal(entry?.assistantMessageKey, assistantMessageKey);
	});

	it("records K3 assistant turns that were observed without reasoning_content", async () => {
		const store = new ThinkingReplayStore();
		await store.initialize(new MemoryThinkingReplayStorage());
		const historyKey = buildOpenAIReplayHistoryKey([{ role: "user", content: "Hello" }]);
		const turn = store.beginTurn({
			modelId: "kimi-k3",
			profileId: "kimi-k3-forced-preserved",
			transport: "openai",
			carrier: "reasoning_content",
			historyKey,
			captureAssistantMessages: true,
			allowsMissingReplayPayload: true,
		});
		store.appendAssistantContent(turn.turnId, "Hello back");
		await store.commit(turn.turnId);

		const assistantMessageKey = buildOpenAIAssistantReplayKey(historyKey, {
			role: "assistant",
			content: "Hello back",
		});
		assert.equal(
			store.lookupAssistant({
				modelId: "kimi-k3",
				assistantMessageKey,
				profileId: "kimi-k3-forced-preserved",
				carrier: "reasoning_content",
			})?.observedWithoutReplayPayload,
			true
		);
	});

	it("marks ambiguous ordinary assistant replay payloads as conflicting", async () => {
		const store = new ThinkingReplayStore();
		await store.initialize(new MemoryThinkingReplayStorage());
		const historyKey = buildOpenAIReplayHistoryKey([{ role: "user", content: "Retryable prompt" }]);

		for (const reasoning of ["first reasoning", "different reasoning"]) {
			const turn = store.beginTurn({
				modelId: "kimi-k3",
				profileId: "kimi-k3-forced-preserved",
				transport: "openai",
				carrier: "reasoning_content",
				historyKey,
				captureAssistantMessages: true,
			});
			store.appendReasoning(turn.turnId, reasoning);
			store.appendAssistantContent(turn.turnId, "Same visible answer");
			await store.commit(turn.turnId);
		}

		const assistantMessageKey = buildOpenAIAssistantReplayKey(historyKey, {
			role: "assistant",
			content: "Same visible answer",
		});
		assert.equal(
			store.lookupAssistant({
				modelId: "kimi-k3",
				assistantMessageKey,
				profileId: "kimi-k3-forced-preserved",
				carrier: "reasoning_content",
			})?.conflictingReplayPayload,
			true
		);
	});

	it("commits and looks up provider-native reasoning_details entries by carrier", async () => {
		const store = new ThinkingReplayStore();
		await store.initialize(new MemoryThinkingReplayStorage());

		const turn = store.beginTurn({
			modelId: "minimax-m2.7",
			profileId: "minimax-m2",
			transport: "openai",
			carrier: "reasoning_details",
		});
		store.appendReasoningDetails(turn.turnId, [
			{ type: "reasoning.text", text: "inspect files", format: "minimax", id: "r1" },
		]);
		store.recordToolCall(turn.turnId, "call_1");

		await store.commit(turn.turnId);

		const entry = store.lookup({
			modelId: "minimax-m2.7",
			callId: "call_1",
			profileId: "minimax-m2",
			carrier: "reasoning_details",
		});
		assert.equal(entry?.carrier, "reasoning_details");
		assert.deepEqual(entry?.reasoningDetails, [
			{ type: "reasoning.text", text: "inspect files", format: "minimax", id: "r1" },
		]);
		assert.equal(entry?.reasoningContent, undefined);
	});

	it("does not satisfy a reasoning_details lookup with a legacy reasoning_content entry", async () => {
		const store = new ThinkingReplayStore();
		await store.initialize(new MemoryThinkingReplayStorage());

		const turn = store.beginTurn("minimax-m2.7");
		store.appendReasoning(turn.turnId, "legacy text");
		store.recordToolCall(turn.turnId, "call_1");
		await store.commit(turn.turnId);

		assert.equal(
			store.lookup({
				modelId: "minimax-m2.7",
				callId: "call_1",
				profileId: "minimax-m2",
				carrier: "reasoning_details",
			}),
			undefined
		);
	});

	it("does not commit aborted, empty, missing-call, or oversized pending turns", async () => {
		const store = new ThinkingReplayStore({ maxPendingTurnBytes: 8 });
		await store.initialize(new MemoryThinkingReplayStorage());

		const aborted = store.beginTurn("mimo-v2.5-pro");
		store.appendReasoning(aborted.turnId, "content");
		store.recordToolCall(aborted.turnId, "call_aborted");
		store.abort(aborted.turnId);
		await store.commit(aborted.turnId);

		const noReasoning = store.beginTurn("mimo-v2.5-pro");
		store.recordToolCall(noReasoning.turnId, "call_no_reasoning");
		await store.commit(noReasoning.turnId);

		const noCallId = store.beginTurn("mimo-v2.5-pro");
		store.appendReasoning(noCallId.turnId, "content");
		await store.commit(noCallId.turnId);

		const oversized = store.beginTurn("mimo-v2.5-pro");
		store.appendReasoning(oversized.turnId, "0123456789");
		store.recordToolCall(oversized.turnId, "call_oversized");
		await store.commit(oversized.turnId);

		assert.equal(store.lookup("mimo-v2.5-pro", "call_aborted"), undefined);
		assert.equal(store.lookup("mimo-v2.5-pro", "call_no_reasoning"), undefined);
		assert.equal(store.lookup("mimo-v2.5-pro", "call_oversized"), undefined);
		assert.equal(store.stats().entryCount, 0);
	});

	it("prunes committed entries by ttl, lru count, and total bytes", async () => {
		let now = 1000;
		const store = new ThinkingReplayStore({
			maxEntries: 2,
			maxTotalBytes: 8,
			ttlMs: 100,
			now: () => now,
		});
		await store.initialize(new MemoryThinkingReplayStorage());

		const first = store.beginTurn("mimo-v2.5-pro");
		store.appendReasoning(first.turnId, "aaaa");
		store.recordToolCall(first.turnId, "call_1");
		await store.commit(first.turnId);

		now = 1010;
		const second = store.beginTurn("mimo-v2.5-pro");
		store.appendReasoning(second.turnId, "bbbb");
		store.recordToolCall(second.turnId, "call_2");
		await store.commit(second.turnId);

		now = 1020;
		const third = store.beginTurn("mimo-v2.5-pro");
		store.appendReasoning(third.turnId, "cccc");
		store.recordToolCall(third.turnId, "call_3");
		await store.commit(third.turnId);

		assert.equal(store.lookup("mimo-v2.5-pro", "call_1"), undefined);
		assert.equal(store.lookup("mimo-v2.5-pro", "call_2")?.reasoningContent, "bbbb");
		assert.equal(store.lookup("mimo-v2.5-pro", "call_3")?.reasoningContent, "cccc");

		now = 1200;
		await store.prune();
		assert.equal(store.stats().entryCount, 0);
	});

	it("persists local plaintext entries and reloads them", async () => {
		const dir = await mkdtemp(join(tmpdir(), "thinking-replay-"));
		try {
			const file = join(dir, "thinking-replay-v1.json");
			const first = new ThinkingReplayStore();
			await first.initialize(new LocalPlaintextThinkingReplayStorage(file));

			const turn = first.beginTurn("deepseek-v4");
			first.appendReasoning(turn.turnId, "persist me");
			first.recordToolCall(turn.turnId, "call_persisted");
			await first.commit(turn.turnId);

			const historyKey = buildOpenAIReplayHistoryKey([{ role: "user", content: "Persisted question" }]);
			const assistantTurn = first.beginTurn({
				modelId: "kimi-k3",
				profileId: "kimi-k3-forced-preserved",
				transport: "openai",
				carrier: "reasoning_content",
				historyKey,
				captureAssistantMessages: true,
			});
			first.appendReasoning(assistantTurn.turnId, "persisted hidden reasoning");
			first.appendAssistantContent(assistantTurn.turnId, "Persisted answer");
			await first.commit(assistantTurn.turnId);

			const observedEmptyTurn = first.beginTurn({
				modelId: "glm-5.2",
				profileId: "glm-5.2-openai",
				transport: "openai",
				carrier: "reasoning_content",
				allowsMissingReplayPayload: true,
			});
			first.recordToolCall(observedEmptyTurn.turnId, "call_observed_empty");
			await first.commit(observedEmptyTurn.turnId);

			const raw = JSON.parse(await readFile(file, "utf8"));
			assert.equal(raw.version, 2);
			assert.equal(raw.entries.length, 3);

			const second = new ThinkingReplayStore();
			await second.initialize(new LocalPlaintextThinkingReplayStorage(file));

			assert.equal(second.lookup("deepseek-v4", "call_persisted")?.reasoningContent, "persist me");
			const assistantMessageKey = buildOpenAIAssistantReplayKey(historyKey, {
				role: "assistant",
				content: "Persisted answer",
			});
			assert.equal(
				second.lookupAssistant({
					modelId: "kimi-k3",
					assistantMessageKey,
					profileId: "kimi-k3-forced-preserved",
					carrier: "reasoning_content",
				})?.reasoningContent,
				"persisted hidden reasoning"
			);
			assert.equal(
				second.lookup({
					modelId: "glm-5.2",
					callId: "call_observed_empty",
					profileId: "glm-5.2-openai",
					carrier: "reasoning_content",
				})?.observedWithoutReplayPayload,
				true
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("does not create a local plaintext cache file before there are committed entries", async () => {
		const dir = await mkdtemp(join(tmpdir(), "thinking-replay-"));
		try {
			const file = join(dir, "thinking-replay-v1.json");
			const store = new ThinkingReplayStore();
			await store.initialize(new LocalPlaintextThinkingReplayStorage(file));
			await store.prune();

			await assert.rejects(() => access(file));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("ignores corrupt local plaintext cache and clears active cache state", async () => {
		const dir = await mkdtemp(join(tmpdir(), "thinking-replay-"));
		try {
			const file = join(dir, "thinking-replay-v1.json");
			const storage = new LocalPlaintextThinkingReplayStorage(file);
			await storage.save([
				{
					modelId: "mimo-v2.5-pro",
					callId: "call_1",
					reasoningContent: "content",
					capturedAt: Date.now(),
					byteLength: 7,
				},
			]);
			await writeFile(file, "{not json", "utf8");

			const store = new ThinkingReplayStore();
			await store.initialize(storage);
			assert.equal(store.stats().entryCount, 0);

			const turn = store.beginTurn("mimo-v2.5-pro");
			store.appendReasoning(turn.turnId, "content");
			store.recordToolCall(turn.turnId, "call_2");
			await store.commit(turn.turnId);
			assert.equal(store.stats().entryCount, 1);

			await store.clear();
			assert.equal(store.stats().entryCount, 0);
			await assert.rejects(() => access(file));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("memory backend never persists entries", async () => {
		const storage = new MemoryThinkingReplayStorage();
		const store = new ThinkingReplayStore();
		await store.initialize(storage);

		const turn = store.beginTurn("mimo-v2.5-pro");
		store.appendReasoning(turn.turnId, "content");
		store.recordToolCall(turn.turnId, "call_1");
		await store.commit(turn.turnId);

		assert.equal(store.lookup("mimo-v2.5-pro", "call_1")?.reasoningContent, "content");
		assert.deepEqual(await storage.load(), []);
	});
});

describe("ThinkingReplayStore jsonl persistence and dedup", () => {
	it("shares one entry across parallel tool calls and evicts them together", async () => {
		let now = 1000;
		const store = new ThinkingReplayStore({ maxTotalBytes: 24, now: () => now });
		await store.initialize(new MemoryThinkingReplayStorage());

		const turn = store.beginTurn("kimi-k3");
		store.appendReasoning(turn.turnId, "shared reasoning!!");
		store.recordToolCall(turn.turnId, "call_a");
		store.recordToolCall(turn.turnId, "call_b");
		store.recordToolCall(turn.turnId, "call_c");
		await store.commit(turn.turnId);

		// One unique entry, payload bytes counted once despite three call ids.
		assert.equal(store.stats().entryCount, 1);
		assert.equal(store.stats().totalBytes, 18);
		assert.equal(store.lookup("kimi-k3", "call_a")?.reasoningContent, "shared reasoning!!");
		assert.equal(store.lookup("kimi-k3", "call_b"), store.lookup("kimi-k3", "call_c"));

		// Evicting the shared entry removes every call-id key at once.
		now = 1010;
		const second = store.beginTurn("kimi-k3");
		store.appendReasoning(second.turnId, "newer reasoning!!!");
		store.recordToolCall(second.turnId, "call_d");
		await store.commit(second.turnId);

		assert.equal(store.stats().entryCount, 1);
		assert.equal(store.lookup("kimi-k3", "call_a"), undefined);
		assert.equal(store.lookup("kimi-k3", "call_b"), undefined);
		assert.equal(store.lookup("kimi-k3", "call_d")?.reasoningContent, "newer reasoning!!!");
	});

	it("appends jsonl lines per commit and reloads shared call ids", async () => {
		const dir = await mkdtemp(join(tmpdir(), "thinking-replay-"));
		try {
			const file = join(dir, "thinking-replay-v2.jsonl");
			const first = new ThinkingReplayStore();
			await first.initialize(new LocalJsonlThinkingReplayStorage(file));

			const turn = first.beginTurn("kimi-k3");
			first.appendReasoning(turn.turnId, "persisted shared reasoning");
			first.recordToolCall(turn.turnId, "call_x");
			first.recordToolCall(turn.turnId, "call_y");
			await first.commit(turn.turnId);

			const raw = await readFile(file, "utf8");
			const lines = raw.trim().split("\n");
			assert.equal(lines.length, 1);
			assert.deepEqual(JSON.parse(lines[0]).callIds, ["call_x", "call_y"]);

			const second = new ThinkingReplayStore();
			await second.initialize(new LocalJsonlThinkingReplayStorage(file));
			assert.equal(second.stats().entryCount, 1);
			assert.equal(second.lookup("kimi-k3", "call_x")?.reasoningContent, "persisted shared reasoning");
			assert.equal(second.lookup("kimi-k3", "call_x"), second.lookup("kimi-k3", "call_y"));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("tolerates a torn trailing jsonl line and keeps earlier entries", async () => {
		const dir = await mkdtemp(join(tmpdir(), "thinking-replay-"));
		try {
			const file = join(dir, "thinking-replay-v2.jsonl");
			const storage = new LocalJsonlThinkingReplayStorage(file);
			await storage.append([
				{
					modelId: "kimi-k3",
					callIds: ["call_ok"],
					reasoningContent: "survives",
					capturedAt: Date.now(),
					byteLength: 8,
				},
			]);
			await writeFile(file, `${await readFile(file, "utf8")}{"modelId":"kimi-k3","cal`, "utf8");

			const store = new ThinkingReplayStore();
			await store.initialize(storage);
			assert.equal(store.stats().entryCount, 1);
			assert.equal(store.lookup("kimi-k3", "call_ok")?.reasoningContent, "survives");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("migrates a legacy v1 json cache into jsonl and removes the old file", async () => {
		const dir = await mkdtemp(join(tmpdir(), "thinking-replay-"));
		try {
			const legacyFile = join(dir, "thinking-replay-v1.json");
			const jsonlFile = join(dir, "thinking-replay-v2.jsonl");
			await new LocalPlaintextThinkingReplayStorage(legacyFile).save([
				{
					modelId: "deepseek-v4",
					callId: "call_legacy",
					reasoningContent: "migrated",
					capturedAt: Date.now(),
					byteLength: 8,
				},
			]);

			const store = new ThinkingReplayStore();
			await store.initialize(new LocalJsonlThinkingReplayStorage(jsonlFile, { legacyJsonFile: legacyFile }));

			assert.equal(store.lookup("deepseek-v4", "call_legacy")?.reasoningContent, "migrated");
			await assert.rejects(() => access(legacyFile));
			const raw = await readFile(jsonlFile, "utf8");
			assert.equal(raw.trim().split("\n").length, 1);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("does not create a jsonl file before there are committed entries", async () => {
		const dir = await mkdtemp(join(tmpdir(), "thinking-replay-"));
		try {
			const file = join(dir, "thinking-replay-v2.jsonl");
			const store = new ThinkingReplayStore();
			await store.initialize(new LocalJsonlThinkingReplayStorage(file));
			await store.prune();

			await assert.rejects(() => access(file));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
