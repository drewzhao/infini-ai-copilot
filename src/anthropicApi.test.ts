import assert from "assert/strict";

const Module = require("module") as any;

function withVscodeMock<T>(fn: () => T): T {
	const originalLoad = Module._load;
	const vscodeMock = {
		workspace: {
			getConfiguration: () => ({
				get: (_key: string, defaultValue?: unknown) => defaultValue,
			}),
		},
		LanguageModelChatMessageRole: {
			User: 1,
			Assistant: 2,
		},
		LanguageModelTextPart: class LanguageModelTextPart {
			constructor(readonly value: string) {}
		},
		LanguageModelDataPart: class LanguageModelDataPart {
			constructor(
				readonly data: Uint8Array,
				readonly mimeType: string
			) {}
		},
		LanguageModelToolCallPart: class LanguageModelToolCallPart {
			constructor(
				readonly callId: string,
				readonly name: string,
				readonly input: unknown
			) {}
		},
	};
	Module._load = (request: string, parent: unknown, isMain: boolean) => {
		if (request === "vscode") {
			return vscodeMock;
		}
		return originalLoad(request, parent, isMain);
	};
	try {
		return fn();
	} finally {
		Module._load = originalLoad;
	}
}

function loadAnthropicApi() {
	for (const id of [
		"./utils",
		"./modelConfiguration",
		"./proposedApi",
		"./commonApi",
		"./thinkingReplayStore",
		"./anthropic/anthropicApi",
	]) {
		delete require.cache[require.resolve(id)];
	}
	return withVscodeMock(() => ({
		anthropic: require("./anthropic/anthropicApi") as typeof import("./anthropic/anthropicApi"),
		replayStore: require("./thinkingReplayStore") as typeof import("./thinkingReplayStore"),
	}));
}

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(chunk));
			}
			controller.close();
		},
	});
}

function token() {
	return {
		get isCancellationRequested() {
			return false;
		},
		onCancellationRequested: () => ({ dispose() {} }),
	};
}

describe("AnthropicApi thinking replay streaming capture", () => {
	it("commits structured thinking when the streamed turn finishes with tool use", async () => {
		const { anthropic, replayStore } = loadAnthropicApi();
		const store = new replayStore.ThinkingReplayStore();
		await store.initialize(new replayStore.MemoryThinkingReplayStorage());
		const pendingTurn = store.beginTurn("mimo-v2.5-pro");
		const api = new anthropic.AnthropicApi({ thinkingReplayStore: store, pendingThinkingTurn: pendingTurn });

		await api.processStreamingResponse(
			streamFromChunks([
				'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"because "}}\n\n',
				'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"reason "}}\n\n',
				'data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig_1"}}\n\n',
				'data: {"type":"content_block_stop","index":0}\n\n',
				'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"read_file","input":{}}}\n\n',
				'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{}"}}\n\n',
				'data: {"type":"content_block_stop","index":1}\n\n',
				'data: {"type":"message_stop"}\n\n',
			]),
			{ report() {} },
			token() as any
		);

		const entry = store.lookup("mimo-v2.5-pro", "toolu_1");
		assert.equal(entry?.reasoningContent, "because reason ");
		assert.equal(entry?.reasoningSignature, "sig_1");
	});

	it("does not commit Anthropic thinking when no tool use is emitted", async () => {
		const { anthropic, replayStore } = loadAnthropicApi();
		const store = new replayStore.ThinkingReplayStore();
		await store.initialize(new replayStore.MemoryThinkingReplayStorage());
		const pendingTurn = store.beginTurn("mimo-v2.5-pro");
		const api = new anthropic.AnthropicApi({ thinkingReplayStore: store, pendingThinkingTurn: pendingTurn });

		await api.processStreamingResponse(
			streamFromChunks([
				'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"because "}}\n\n',
				'data: {"type":"content_block_stop","index":0}\n\n',
				'data: {"type":"message_stop"}\n\n',
			]),
			{ report() {} },
			token() as any
		);

		assert.equal(store.stats().entryCount, 0);
	});
});
