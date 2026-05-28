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
		LanguageModelChatToolMode: {
			Required: 1,
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

describe("AnthropicApi.prepareRequestBody MiniMax request controls", () => {
	it("always sends reasoning_split for MiniMax models", () => {
		const { anthropic } = loadAnthropicApi();
		const api = new anthropic.AnthropicApi();

		const body = api.prepareRequestBody(
			{
				model: "minimax-m2.7",
				messages: [],
				stream: true,
				max_tokens: 16,
			},
			{ id: "minimax-m2.7" } as any,
			{ modelOptions: {}, tools: [] } as any
		);

		assert.equal(body.reasoning_split, true);
	});

	it("keeps manually routed Kimi Anthropic requests in safe-off thinking mode", () => {
		const { anthropic } = loadAnthropicApi();
		const api = new anthropic.AnthropicApi();

		const body = api.prepareRequestBody(
			{
				model: "kimi-k2.6",
				messages: [],
				stream: true,
				max_tokens: 1024,
			},
			{ id: "kimi-k2.6" } as any,
			{ modelOptions: {}, tools: [] } as any
		);

		assert.deepEqual(body.thinking, { type: "disabled" });
		assert.equal(body.output_config, undefined);
	});

	it("sanitizes Kimi tool schemas before sending Anthropic Messages requests", () => {
		const { anthropic } = loadAnthropicApi();
		const api = new anthropic.AnthropicApi();

		const body = api.prepareRequestBody(
			{
				model: "kimi-k2.6",
				messages: [],
				stream: true,
				max_tokens: 1024,
			},
			{ id: "kimi-k2.6" } as any,
			{
				modelOptions: {},
				tools: [
					{
						name: "search",
						description: "Search",
						inputSchema: {
							type: "object",
							properties: {
								query: { enum: ["", "code"] },
							},
						},
					},
				],
			} as any
		);

		assert.deepEqual(body.tools?.[0]?.input_schema, {
			type: "object",
			properties: {
				query: {
					type: "string",
					enum: ["code"],
				},
			},
		});
	});
});

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

	it("fails clearly when input_json_delta arrives without a matching tool_use block", async () => {
		const { anthropic } = loadAnthropicApi();
		const api = new anthropic.AnthropicApi();

		await assert.rejects(
			api.processStreamingResponse(
				streamFromChunks([
					'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"because "}}\n\n',
					'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{}"}}\n\n',
					'data: {"type":"message_stop"}\n\n',
				]),
				{ report() {} },
				token() as any
			),
			/Anthropic stream input_json_delta without active tool_use block/
		);
	});
});
