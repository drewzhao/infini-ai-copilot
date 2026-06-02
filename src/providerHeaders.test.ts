import assert from "assert/strict";

const Module = require("module") as any;

function loadProvider() {
	const originalLoad = Module._load;
	const vscodeMock = {
		EventEmitter: class EventEmitter<T> {
			event = () => ({ dispose() {} });
			fire(_value?: T) {}
			dispose() {}
		},
		ThemeIcon: class {
			constructor(readonly id: string) {}
		},
		ThemeColor: class {
			constructor(readonly id: string) {}
		},
		CancellationTokenSource: class {
			token = {
				isCancellationRequested: false,
				onCancellationRequested: () => ({ dispose() {} }),
			};
			dispose() {}
		},
		workspace: {
			getConfiguration: () => ({
				get: (_key: string, defaultValue?: unknown) => defaultValue,
			}),
		},
		window: {
			showErrorMessage: async () => undefined,
			showWarningMessage: async () => undefined,
		},
		commands: {
			executeCommand: async () => undefined,
		},
		env: {
			appName: "VS Code",
			openExternal: async () => undefined,
		},
		Uri: {
			parse: (value: string) => ({ toString: () => value }),
		},
		LanguageModelChatMessageRole: {
			User: 1,
			Assistant: 2,
		},
		LanguageModelChatToolMode: {
			Required: 1,
		},
		l10n: {
			t: (message: string, ...args: unknown[]) =>
				args.length === 0 ? message : message.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)])),
		},
	};

	for (const id of ["./provider", "./utils", "./statusBar", "./errorActions"]) {
		delete require.cache[require.resolve(id)];
	}

	Module._load = (request: string, parent: unknown, isMain: boolean) => {
		if (request === "vscode") {
			return vscodeMock;
		}
		return originalLoad(request, parent, isMain);
	};
	try {
		return require("./provider") as typeof import("./provider");
	} finally {
		Module._load = originalLoad;
	}
}

describe("InfiniAIChatModelProvider request headers", () => {
	it("sends Bearer auth as well as x-api-key on Anthropic Messages routes", () => {
		const { InfiniAIChatModelProvider } = loadProvider();
		const provider = new InfiniAIChatModelProvider({} as any, "test-agent", {} as any, { appendLine() {} } as any);

		const headers = (provider as any).requestHeaders({ transport: "anthropic" }, "sk-test");

		assert.equal(headers.Authorization, "Bearer sk-test");
		assert.equal(headers["x-api-key"], "sk-test");
		assert.equal(headers["anthropic-version"], "2023-06-01");
		assert.equal(headers["Content-Type"], "application/json");
	});
});
