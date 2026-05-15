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
	for (const id of ["./utils", "./thinkingMode", "./proposedApi", "./commonApi", "./openai/openaiApi"]) {
		delete require.cache[require.resolve(id)];
	}
	return withVscodeMock(configValues, () => ({
		openai: require("./openai/openaiApi") as typeof import("./openai/openaiApi"),
		proposedApi: require("./proposedApi") as typeof import("./proposedApi"),
		withVscode: <T>(fn: () => T) => withVscodeMock(configValues, fn),
	}));
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
});
