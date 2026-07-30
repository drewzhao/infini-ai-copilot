import assert from "assert/strict";

const Module = require("module") as any;

function withVscodeMock<T>(configValues: Record<string, unknown>, fn: (vscodeMock: any) => T): T {
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
		return fn(vscodeMock);
	} finally {
		Module._load = originalLoad;
	}
}

function loadOpenaiApi(configValues: Record<string, unknown> = {}) {
	for (const id of [
		"./utils",
		"./thinkingMode",
		"./proposedApi",
		"./commonApi",
		"./thinkingReplayStore",
		"./openai/openaiApi",
	]) {
		delete require.cache[require.resolve(id)];
	}
	return withVscodeMock(configValues, (vscode) => ({
		openai: require("./openai/openaiApi") as typeof import("./openai/openaiApi"),
		proposedApi: require("./proposedApi") as typeof import("./proposedApi"),
		replayStore: require("./thinkingReplayStore") as typeof import("./thinkingReplayStore"),
		vscode,
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

describe("OpenaiApi.convertMessages image input", () => {
	it("serializes text and image input as OpenAI-compatible content", () => {
		const { openai, vscode } = loadOpenaiApi();
		const api = new openai.OpenaiApi();

		const messages = api.convertMessages(
			[
				{
					role: vscode.LanguageModelChatMessageRole.User,
					name: undefined,
					content: [
						new vscode.LanguageModelTextPart("Describe this image."),
						new vscode.LanguageModelDataPart(new Uint8Array([1, 2, 3]), "image/png"),
					],
				},
			],
			{ includeReasoningInRequest: false }
		);

		assert.deepEqual(messages, [
			{
				role: "user",
				content: [
					{ type: "text", text: "Describe this image." },
					{ type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
				],
				cache_control: { type: "ephemeral" },
			},
		]);
	});

	it("preserves image-only user input", () => {
		const { openai, vscode } = loadOpenaiApi();
		const api = new openai.OpenaiApi();

		const messages = api.convertMessages(
			[
				{
					role: vscode.LanguageModelChatMessageRole.User,
					name: undefined,
					content: [new vscode.LanguageModelDataPart(new Uint8Array([1, 2, 3]), "image/png")],
				},
			],
			{ includeReasoningInRequest: false }
		);

		assert.deepEqual(messages, [
			{
				role: "user",
				content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AQID" } }],
				cache_control: { type: "ephemeral" },
			},
		]);
	});
});

describe("OpenaiApi.prepareRequestBody thinking-mode guard", () => {
	it("sanitizes Kimi tool schemas before sending OpenAI-compatible requests", () => {
		const { openai, withVscode } = loadOpenaiApi();

		const api = new openai.OpenaiApi();
		const rb = withVscode(() =>
			api.prepareRequestBody(
				{ model: "kimi-k2.6" },
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
			)
		);

		assert.deepEqual(rb.tools?.[0]?.function?.parameters, {
			type: "object",
			properties: {
				query: {
					type: "string",
					enum: ["code"],
				},
			},
		});
	});

	it("uses K3 string required tool choice and sanitizes every advertised tool", () => {
		const { openai, withVscode } = loadOpenaiApi();

		const api = new openai.OpenaiApi();
		const rb = withVscode(() =>
			api.prepareRequestBody(
				{ model: "kimi-k3" },
				{ id: "kimi-k3" } as any,
				{
					modelOptions: {},
					toolMode: 1,
					tools: [
						{
							name: "search",
							inputSchema: { type: "object", properties: { query: { enum: ["", "code"] } } },
						},
						{
							name: "read",
							inputSchema: { type: "object", properties: { path: { type: "string" } } },
						},
					],
				} as any,
				true
			)
		);

		assert.equal(rb.tool_choice, "required");
		assert.equal(rb.reasoning_effort, "max");
		assert.deepEqual(rb.tools[0].function.parameters.properties.query, {
			type: "string",
			enum: ["code"],
		});
	});

	it("uses string required tool choice without a default effort for verified DeepSeek V4 models", () => {
		const { openai, withVscode } = loadOpenaiApi();

		for (const modelId of ["deepseek-v4-pro", "deepseek-v4-flash"]) {
			const api = new openai.OpenaiApi();
			const rb = withVscode(() =>
				api.prepareRequestBody(
					{ model: modelId },
					{ id: modelId } as any,
					{
						modelOptions: {},
						toolMode: 1,
						tools: [
							{ name: "search", inputSchema: { type: "object", properties: {} } },
							{ name: "read", inputSchema: { type: "object", properties: {} } },
						],
					} as any,
					true
				)
			);

			assert.equal(rb.tool_choice, "required", modelId);
			assert.equal(rb.reasoning_effort, undefined, modelId);
		}
	});

	it("rejects required tool mode locally for Kimi K2.6 and K2.7", () => {
		const { openai, withVscode } = loadOpenaiApi();

		for (const modelId of ["kimi-k2.6", "kimi-k2.7-code"]) {
			const api = new openai.OpenaiApi();
			assert.throws(
				() =>
					withVscode(() =>
						api.prepareRequestBody(
							{ model: modelId },
							{ id: modelId } as any,
							{
								modelOptions: {},
								toolMode: 1,
								tools: [{ name: "search", inputSchema: { type: "object", properties: {} } }],
							} as any
						)
					),
				/Required is not supported by this model profile/,
				modelId
			);
		}
	});

	it("sanitizes MiMo tool schemas before sending OpenAI-compatible requests", () => {
		const { openai, withVscode } = loadOpenaiApi();

		const api = new openai.OpenaiApi();
		const rb = withVscode(() =>
			api.prepareRequestBody(
				{ model: "mimo-v2.5-pro" },
				{ id: "mimo-v2.5-pro" } as any,
				{
					modelOptions: {},
					tools: [
						{
							name: "collect_labels",
							description: "Collect labels",
							inputSchema: {
								type: "object",
								properties: {
									labels: {
										type: "array",
										items: [],
									},
								},
							},
						},
					],
				} as any
			)
		);

		assert.deepEqual(rb.tools?.[0]?.function?.parameters, {
			type: "object",
			properties: {
				labels: {
					type: "array",
					items: {},
				},
			},
		});
	});

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

		assert.equal(rb.enable_thinking, undefined);
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

		assert.equal(rb.enable_thinking, undefined);
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

	it("does not send a persisted output limit above the current model maximum", () => {
		const { openai, withVscode } = loadOpenaiApi();
		const api = new openai.OpenaiApi();

		const rb = withVscode(() =>
			api.prepareRequestBody(
				{ model: "custom-model" },
				{ id: "custom-model" } as any,
				{
					modelOptions: {},
					modelConfiguration: { maxOutputTokens: 16384 },
				} as any,
				false,
				8192
			)
		);

		assert.equal(rb.max_tokens, undefined);
	});
});

describe("OpenaiApi thinking replay streaming capture", () => {
	it("commits ordinary K3 assistant reasoning with the streamed visible response", async () => {
		const { openai, replayStore, vscode } = loadOpenaiApi();
		const store = new replayStore.ThinkingReplayStore();
		await store.initialize(new replayStore.MemoryThinkingReplayStorage());
		const history = [{ role: "user" as const, content: "First question" }];
		const historyKey = replayStore.buildOpenAIReplayHistoryKey(history);
		const pendingTurn = store.beginTurn({
			modelId: "kimi-k3",
			profileId: "kimi-k3-forced-preserved",
			transport: "openai",
			carrier: "reasoning_content",
			historyKey,
			captureAssistantMessages: true,
			allowsMissingReplayPayload: true,
		});
		const api = new openai.OpenaiApi({ thinkingReplayStore: store, pendingThinkingTurn: pendingTurn });

		await api.processStreamingResponse(
			streamFromChunks([
				'data: {"choices":[{"delta":{"reasoning_content":"because "}}]}\n\n',
				'data: {"choices":[{"delta":{"content":"Final"}}]}\n\n',
				'data: {"choices":[{"delta":{"content":", answer"},"finish_reason":"stop"}]}\n\n',
				"data: [DONE]\n\n",
			]),
			{ report() {} },
			token() as any
		);

		const [assistantMessage] = api.convertMessages(
			[
				{
					role: vscode.LanguageModelChatMessageRole.Assistant,
					name: undefined,
					content: [new vscode.LanguageModelTextPart("Final"), new vscode.LanguageModelTextPart(", answer")],
				},
			],
			{ includeReasoningInRequest: false }
		);
		assert.equal(assistantMessage.content, "Final, answer");
		const assistantMessageKey = replayStore.buildOpenAIAssistantReplayKey(historyKey, assistantMessage);
		assert.equal(
			store.lookupAssistant({
				modelId: "kimi-k3",
				assistantMessageKey,
				profileId: "kimi-k3-forced-preserved",
				carrier: "reasoning_content",
			})?.reasoningContent,
			"because "
		);
	});

	it("commits a generated fallback sentinel before ending a strict K2.7 replay turn", async () => {
		const { openai, replayStore } = loadOpenaiApi();
		const store = new replayStore.ThinkingReplayStore();
		await store.initialize(new replayStore.MemoryThinkingReplayStorage());
		const history = [{ role: "user" as const, content: "Answer directly" }];
		const historyKey = replayStore.buildOpenAIReplayHistoryKey(history);
		const pendingTurn = store.beginTurn({
			modelId: "kimi-k2.7-code",
			profileId: "kimi-k2.7-code-forced-preserved",
			transport: "openai",
			carrier: "reasoning_content",
			historyKey,
			captureAssistantMessages: true,
		});
		const api = new openai.OpenaiApi({ thinkingReplayStore: store, pendingThinkingTurn: pendingTurn });
		const reported: string[] = [];

		await api.processStreamingResponse(
			streamFromChunks(['data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n', "data: [DONE]\n\n"]),
			{
				report(part: any) {
					reported.push(part.value);
				},
			},
			token() as any
		);

		assert.deepEqual(reported, ["The model finished without returning a final answer. Please retry."]);
		const assistantMessageKey = replayStore.buildOpenAIAssistantReplayKey(historyKey, {
			role: "assistant",
			content: reported[0],
		});
		assert.equal(
			store.lookupAssistant({
				modelId: "kimi-k2.7-code",
				assistantMessageKey,
				profileId: "kimi-k2.7-code-forced-preserved",
				carrier: "reasoning_content",
			})?.observedWithoutReplayPayload,
			true
		);
	});

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

	it("commits choice-level reasoning_content before streamed tool calls", async () => {
		const { openai, replayStore } = loadOpenaiApi();
		const store = new replayStore.ThinkingReplayStore();
		await store.initialize(new replayStore.MemoryThinkingReplayStorage());
		const pendingTurn = store.beginTurn({
			modelId: "glm-5.1",
			profileId: "glm-5-default-thinking",
			transport: "openai",
			carrier: "reasoning_content",
		});
		const api = new openai.OpenaiApi({ thinkingReplayStore: store, pendingThinkingTurn: pendingTurn });

		await api.processStreamingResponse(
			streamFromChunks([
				'data: {"choices":[{"reasoning_content":"because "}]}\n\n',
				'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file","arguments":"{}"}}]}}]}\n\n',
				'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
				"data: [DONE]\n\n",
			]),
			{ report() {} },
			token() as any
		);

		assert.equal(
			store.lookup({
				modelId: "glm-5.1",
				callId: "call_1",
				profileId: "glm-5-default-thinking",
				carrier: "reasoning_content",
			})?.reasoningContent,
			"because "
		);
	});

	it("commits an observed-empty marker for a completed GLM-5.2 tool turn", async () => {
		const { openai, replayStore } = loadOpenaiApi();
		const store = new replayStore.ThinkingReplayStore();
		await store.initialize(new replayStore.MemoryThinkingReplayStorage());
		const pendingTurn = store.beginTurn({
			modelId: "glm-5.2",
			profileId: "glm-5.2-openai",
			transport: "openai",
			carrier: "reasoning_content",
			allowsMissingReplayPayload: true,
		});
		const api = new openai.OpenaiApi({ thinkingReplayStore: store, pendingThinkingTurn: pendingTurn });

		await api.processStreamingResponse(
			streamFromChunks([
				'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_no_reasoning","function":{"name":"read_file","arguments":"{}"}}]}}]}\n\n',
				'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
				"data: [DONE]\n\n",
			]),
			{ report() {} },
			token() as any
		);

		const entry = store.lookup({
			modelId: "glm-5.2",
			callId: "call_no_reasoning",
			profileId: "glm-5.2-openai",
			carrier: "reasoning_content",
		});
		assert.equal(entry?.observedWithoutReplayPayload, true);
		assert.equal(entry?.reasoningContent, undefined);
	});

	it("does not commit a GLM-5.2 observed-empty marker for an aborted stream", async () => {
		const { openai, replayStore } = loadOpenaiApi();
		const store = new replayStore.ThinkingReplayStore();
		await store.initialize(new replayStore.MemoryThinkingReplayStorage());
		const pendingTurn = store.beginTurn({
			modelId: "glm-5.2",
			profileId: "glm-5.2-openai",
			transport: "openai",
			carrier: "reasoning_content",
			allowsMissingReplayPayload: true,
		});
		const api = new openai.OpenaiApi({ thinkingReplayStore: store, pendingThinkingTurn: pendingTurn });

		await assert.rejects(
			api.processStreamingResponse(
				streamFromChunks([
					'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_aborted","function":{"name":"read_file","arguments":"{}"}}]}}]}\n\n',
					"data: {not-json}\n\n",
				]),
				{ report() {} },
				token() as any
			),
			/OpenAI stream parse failed/
		);

		assert.equal(
			store.lookup({
				modelId: "glm-5.2",
				callId: "call_aborted",
				profileId: "glm-5.2-openai",
				carrier: "reasoning_content",
			}),
			undefined
		);
	});

	it("commits structured reasoning when the stream completes after tool calls without finish_reason", async () => {
		const { openai, replayStore } = loadOpenaiApi();
		const store = new replayStore.ThinkingReplayStore();
		await store.initialize(new replayStore.MemoryThinkingReplayStorage());
		const pendingTurn = store.beginTurn("mimo-v2.5-pro");
		const api = new openai.OpenaiApi({ thinkingReplayStore: store, pendingThinkingTurn: pendingTurn });

		await api.processStreamingResponse(
			streamFromChunks([
				'data: {"choices":[{"delta":{"reasoning_content":"because "}}]}\n\n',
				'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file","arguments":"{}"}}]}}]}\n\n',
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

	it("commits raw reasoning_details for MiniMax split-mode replay capture", async () => {
		const { openai, replayStore } = loadOpenaiApi();
		const store = new replayStore.ThinkingReplayStore();
		await store.initialize(new replayStore.MemoryThinkingReplayStorage());
		const pendingTurn = store.beginTurn({
			modelId: "minimax-m2.7",
			profileId: "minimax-m2",
			transport: "openai",
			carrier: "reasoning_details",
		});
		const api = new openai.OpenaiApi({
			thinkingReplayStore: store,
			pendingThinkingTurn: pendingTurn,
			replayCarrier: "reasoning_details",
		});

		await api.processStreamingResponse(
			streamFromChunks([
				'data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.text","text":"because","format":"minimax","id":"r1"}]}}]}\n\n',
				'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file","arguments":"{}"}}]}}]}\n\n',
				'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
				"data: [DONE]\n\n",
			]),
			{ report() {} },
			token() as any
		);

		const entry = store.lookup({
			modelId: "minimax-m2.7",
			callId: "call_1",
			profileId: "minimax-m2",
			carrier: "reasoning_details",
		});
		assert.deepEqual(entry?.reasoningDetails, [
			{ type: "reasoning.text", text: "because", format: "minimax", id: "r1" },
		]);
		assert.equal(entry?.reasoningContent, undefined);
	});
});

describe("OpenaiApi streaming response visibility", () => {
	it("emits final-answer text that follows an XML think block in the same chunk", async () => {
		const { openai } = loadOpenaiApi();
		const api = new openai.OpenaiApi();
		const reported: string[] = [];

		await api.processStreamingResponse(
			streamFromChunks([
				'data: {"choices":[{"delta":{"content":"<think>private reasoning</think>Final answer"},"finish_reason":"stop"}]}\n\n',
				"data: [DONE]\n\n",
			]),
			{
				report(part: any) {
					reported.push(part.value);
				},
			},
			token() as any
		);

		assert.deepEqual(reported, ["Final answer"]);
	});

	it("keeps split XML think tags hidden while preserving visible text", async () => {
		const { openai } = loadOpenaiApi();
		const api = new openai.OpenaiApi();
		const reported: string[] = [];

		await api.processStreamingResponse(
			streamFromChunks([
				'data: {"choices":[{"delta":{"content":"<thi"}}]}\n\n',
				'data: {"choices":[{"delta":{"content":"nk>private reasoning</thi"}}]}\n\n',
				'data: {"choices":[{"delta":{"content":"nk>Visible"},"finish_reason":"stop"}]}\n\n',
				"data: [DONE]\n\n",
			]),
			{
				report(part: any) {
					reported.push(part.value);
				},
			},
			token() as any
		);

		assert.deepEqual(reported, ["Visible"]);
	});

	it("suppresses VS Code thinking parts when response thinking is disabled", async () => {
		const { openai, proposedApi } = loadOpenaiApi();
		class FakeThinkingPart {
			constructor(
				readonly value: string,
				readonly id?: string
			) {}
		}
		proposedApi._setThinkingPartCtorForTest(
			FakeThinkingPart as unknown as ReturnType<typeof proposedApi.getThinkingPartCtor>
		);
		const api = new openai.OpenaiApi({ emitThinkingParts: false });
		const reported: any[] = [];

		await api.processStreamingResponse(
			streamFromChunks([
				'data: {"choices":[{"delta":{"reasoning_content":"private reasoning"}}]}\n\n',
				'data: {"choices":[{"delta":{"content":"Visible"},"finish_reason":"stop"}]}\n\n',
				"data: [DONE]\n\n",
			]),
			{
				report(part: any) {
					reported.push(part);
				},
			},
			token() as any
		);

		assert.equal(reported.length, 1);
		assert.equal(reported[0].value, "Visible");
		assert.ok(!(reported[0] instanceof FakeThinkingPart));
	});

	it("emits a safe fallback instead of returning no visible response for reasoning-only streams", async () => {
		const { openai } = loadOpenaiApi();
		const api = new openai.OpenaiApi();
		const reported: string[] = [];

		await api.processStreamingResponse(
			streamFromChunks([
				'data: {"choices":[{"delta":{"reasoning_content":"private reasoning"}}]}\n\n',
				'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":12}}\n\n',
				"data: [DONE]\n\n",
			]),
			{
				report(part: any) {
					reported.push(part.value);
				},
			},
			token() as any
		);

		assert.deepEqual(reported, [
			"The model returned hidden reasoning but no final answer. Please retry with a direct final-answer instruction.",
		]);
	});
});
