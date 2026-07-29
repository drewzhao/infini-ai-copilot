import assert from "assert/strict";

const Module = require("module") as any;

class TestCancellationError extends Error {
	constructor() {
		super("Canceled");
		this.name = "CancellationError";
	}
}

function loadParticipant() {
	const originalLoad = Module._load;
	let capturedHandler: any;
	const vscodeMock = {
		CancellationError: TestCancellationError,
		ThemeIcon: class {
			constructor(readonly id: string) {}
		},
		l10n: {
			t: (message: string, ...args: unknown[]) =>
				args.length === 0 ? message : message.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)])),
		},
		chat: {
			createChatParticipant: (id: string, handler: any) => {
				capturedHandler = handler;
				return { id, dispose() {} };
			},
		},
	};
	delete require.cache[require.resolve("./participant")];
	delete require.cache[require.resolve("./utils")];
	Module._load = (request: string, parent: unknown, isMain: boolean) => {
		if (request === "vscode") {
			return vscodeMock;
		}
		return originalLoad(request, parent, isMain);
	};
	try {
		return {
			module: require("./participant") as typeof import("./participant"),
			getHandler: () => capturedHandler,
		};
	} finally {
		Module._load = originalLoad;
	}
}

function stream() {
	const chunks: string[] = [];
	return {
		chunks,
		stream: {
			markdown: (value: string) => chunks.push(value),
		},
	};
}

function token() {
	return {
		isCancellationRequested: false,
		onCancellationRequested: () => ({ dispose() {} }),
	};
}

describe("chat participant", () => {
	it("reports sanitized doctor output", async () => {
		const loaded = loadParticipant();
		const participant = loaded.module.registerInfiniAIChatParticipant(
			{
				getDiagnostics: async () => ({
					vscodeVersion: "1.117.0",
					providerGroupCount: 1,
					modelCount: 2,
					discoveryStats: {
						rawModelCount: 5,
						chatModelCount: 2,
						nonChatModelCount: 2,
						unknownModelTypeCount: 1,
						malformedModelCount: 0,
						duplicateModelCount: 0,
						liveOutputLimitCount: 2,
					},
					routeConfigCount: 3,
					exactModelRouteOverrideCount: 2,
					cacheAgeMs: 1500,
					modelDiscoveryUrl: "https://cloud.infini-ai.com/maas/v1/models",
					lastError: "authorization: Bearer secret-token",
					groups: [
						{
							name: "InfiniAI",
							modelCount: 2,
							lastError: "authorization: Bearer secret-token",
						},
					],
				}),
			} as any,
			{ appendLine() {} } as any
		) as any;

		const out = stream();
		await loaded.getHandler()({ command: "doctor", prompt: "" }, {}, out.stream, token());

		assert.equal(participant.id, "infiniai");
		assert.equal(participant.iconPath.id, "sparkle");
		assert.match(out.chunks[0], /InfiniAI Doctor/);
		assert.match(out.chunks[0], /Provider groups: 1/);
		assert.match(out.chunks[0], /Discovery summary: 5 rows; 2 chat-eligible; 2 non-chat filtered/);
		assert.match(out.chunks[0], /Route overrides: 3/);
		assert.match(out.chunks[0], /Exact model route overrides: 2/);
		assert.match(out.chunks[0], /\[REDACTED\]/);
		assert.doesNotMatch(out.chunks[0], /secret-token/);
	});

	it("refreshes and lists models", async () => {
		const loaded = loadParticipant();
		let refreshValue: boolean | undefined;
		loaded.module.registerInfiniAIChatParticipant(
			{
				getModelDescriptions: async (refresh: boolean) => {
					refreshValue = refresh;
					return [
						{
							id: "model-a",
							group: "InfiniAI",
							transport: "anthropic",
							routeSource: "metadata",
							toolCalling: true,
							imageInput: false,
							maxInputTokens: 1000,
							maxOutputTokens: 100,
						},
					];
				},
			} as any,
			{ appendLine() {} } as any
		);

		const out = stream();
		await loaded.getHandler()({ command: "models", prompt: "refresh" }, {}, out.stream, token());

		assert.equal(refreshValue, true);
		assert.match(out.chunks[0], /InfiniAI Models/);
		assert.match(out.chunks[0], /model-a/);
		assert.match(out.chunks[0], /anthropic/);
		assert.match(out.chunks[0], /metadata/);
	});

	it("shows command help by default", async () => {
		const loaded = loadParticipant();
		loaded.module.registerInfiniAIChatParticipant({} as any, { appendLine() {} } as any);

		const out = stream();
		await loaded.getHandler()({ command: undefined, prompt: "" }, {}, out.stream, token());

		assert.match(out.chunks[0], /\/doctor/);
		assert.match(out.chunks[0], /\/models refresh/);
		assert.match(out.chunks[0], /\/test/);
	});
});
