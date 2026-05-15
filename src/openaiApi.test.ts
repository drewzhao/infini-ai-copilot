import assert from "assert/strict";

const Module = require("module") as any;

function withVscodeMock<T>(configValues: Record<string, unknown>, fn: () => T): T {
	const originalLoad = Module._load;
	const vscodeMock = {
		workspace: {
			getConfiguration: () => ({
				get: (key: string, defaultValue?: unknown) => configValues[key] ?? defaultValue,
			}),
		},
		LanguageModelChatToolMode: {
			Required: 1,
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

function loadOpenaiApi(configValues: Record<string, unknown> = {}) {
	for (const id of ["./utils", "./thinkingMode", "./proposedApi", "./commonApi", "./thinkingReplayStore", "./openai/openaiApi"]) {
		delete require.cache[require.resolve(id)];
	}
	return withVscodeMock(configValues, () => ({
		openai: require("./openai/openaiApi") as typeof import("./openai/openaiApi"),
		proposedApi: require("./proposedApi") as typeof import("./proposedApi"),
		replayStore: require("./thinkingReplayStore") as typeof import("./thinkingReplayStore"),
		withVscode: <T>(fn: () => T) => withVscodeMock(configValues, fn),
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

describe("OpenaiApi.prepareRequestBody thinking-mode guard", () => {
	it("force-disables affected models even when LanguageModelThinkingPart exists", () => {
		const { openai, proposedApi, withVscode } = loadOpenaiApi();
		class FakeThinkingPart {
			constructor(readonly value: string) {}
		}
		proposedApi._setThinkingPartCtorForTest(
			FakeThinkingPart as unknown as ReturnType<typeof proposedApi.getThinkingPartCtor>
		);

		const api = new openai.OpenaiApi();
		const rb = withVscode(() =>
			api.prepareRequestBody(
				{ model: "mimo-v2.5-pro" },
				{ id: "mimo-v2.5-pro" } as any,
				{ modelOptions: {}, tools: [] } as any
			)
		);

		assert.equal(rb.enable_thinking, false);
		assert.deepEqual(rb.thinking, { type: "disabled" });
	});

	it("does not let explicit round-trip opt-in bypass the guard without a verified replay backend", () => {
		const { openai, proposedApi, withVscode } = loadOpenaiApi({
			enableThinkingRoundTripForModels: ["mimo-v2.5-pro"],
		});
		class FakeThinkingPart {
			constructor(readonly value: string) {}
		}
		proposedApi._setThinkingPartCtorForTest(
			FakeThinkingPart as unknown as ReturnType<typeof proposedApi.getThinkingPartCtor>
		);

		const api = new openai.OpenaiApi();
		const rb = withVscode(() =>
			api.prepareRequestBody(
				{ model: "mimo-v2.5-pro" },
				{ id: "mimo-v2.5-pro" } as any,
				{ modelOptions: {}, tools: [] } as any
			)
		);

		assert.equal(rb.enable_thinking, false);
		assert.deepEqual(rb.thinking, { type: "disabled" });
	});

	it("allows explicit round-trip opt-in when replay preflight is safe", () => {
		const { openai, withVscode } = loadOpenaiApi({
			enableThinkingRoundTripForModels: ["mimo-v2.5-pro"],
		});

		const api = new openai.OpenaiApi();
		const rb = withVscode(() =>
			api.prepareRequestBody(
				{ model: "mimo-v2.5-pro" },
				{ id: "mimo-v2.5-pro" } as any,
				{ modelOptions: {}, tools: [] } as any,
				true
			)
		);

		assert.equal(rb.enable_thinking, undefined);
		assert.equal(rb.thinking, undefined);
	});
});

describe("OpenaiApi thinking replay streaming capture", () => {
	it("commits structured reasoning when the streamed turn finishes with tool calls", async () => {
		const { openai, replayStore } = loadOpenaiApi();
		const store = new replayStore.ThinkingReplayStore();
		await store.initialize(new replayStore.MemoryThinkingReplayStorage());
		const pendingTurn = store.beginTurn("mimo-v2.5-pro");
		const api = new openai.OpenaiApi({ thinkingReplayStore: store, pendingThinkingTurn: pendingTurn });

		await api.processStreamingResponse(
			streamFromChunks([
				'data: {"choices":[{"delta":{"reasoning_content":"because "}}]}\n\n',
				'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file","arguments":"{}"}}]}}]}\n\n',
				'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
				"data: [DONE]\n\n",
			]),
			{ report() {} },
			token() as any
		);

		assert.equal(store.lookup("mimo-v2.5-pro", "call_1")?.reasoningContent, "because ");
	});

	it("aborts structured reasoning capture when the streamed turn stops without tool calls", async () => {
		const { openai, replayStore } = loadOpenaiApi();
		const store = new replayStore.ThinkingReplayStore();
		await store.initialize(new replayStore.MemoryThinkingReplayStorage());
		const pendingTurn = store.beginTurn("mimo-v2.5-pro");
		const api = new openai.OpenaiApi({ thinkingReplayStore: store, pendingThinkingTurn: pendingTurn });

		await api.processStreamingResponse(
			streamFromChunks([
				'data: {"choices":[{"delta":{"reasoning_content":"because "}}]}\n\n',
				'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
				"data: [DONE]\n\n",
			]),
			{ report() {} },
			token() as any
		);

		assert.equal(store.stats().entryCount, 0);
	});
});
