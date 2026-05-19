import assert from "assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import {
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
		assert.equal(entry?.callId, "call_1");
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

			const raw = JSON.parse(await readFile(file, "utf8"));
			assert.equal(raw.version, 1);
			assert.equal(raw.entries.length, 1);

			const second = new ThinkingReplayStore();
			await second.initialize(new LocalPlaintextThinkingReplayStorage(file));

			assert.equal(second.lookup("deepseek-v4", "call_persisted")?.reasoningContent, "persist me");
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
