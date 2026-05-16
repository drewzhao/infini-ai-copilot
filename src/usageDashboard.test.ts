import assert from "assert/strict";

const Module = require("module") as any;

interface UsageRecordForTest {
	readonly ts: number;
	readonly modelId: string;
	readonly transport: string;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cachedTokens?: number;
}

function loadUsageDashboard(options: { warningResult?: string } = {}) {
	const originalLoad = Module._load;
	const warningCalls: unknown[][] = [];
	const stateUpdates: Array<{ key: string; value: unknown }> = [];
	const vscodeMock = {
		Disposable: {
			from: (...items: Array<{ dispose?: () => void }>) => ({
				dispose() {
					for (const item of items) {
						item.dispose?.();
					}
				},
			}),
		},
		Uri: {
			file: (path: string) => ({ fsPath: path }),
		},
		l10n: {
			t: (message: string, ...args: unknown[]) =>
				args.length === 0 ? message : message.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)])),
		},
		window: {
			onDidChangeActiveColorTheme: () => ({ dispose() {} }),
			showInformationMessage: async () => undefined,
			showSaveDialog: async () => undefined,
			showWarningMessage: async (...args: unknown[]) => {
				warningCalls.push(args);
				return options.warningResult;
			},
			registerWebviewViewProvider: () => ({ dispose() {} }),
		},
		workspace: {
			fs: {
				writeFile: async () => undefined,
			},
		},
	};

	delete require.cache[require.resolve("./views/usageDashboard")];
	Module._load = (request: string, parent: unknown, isMain: boolean) => {
		if (request === "vscode") {
			return vscodeMock;
		}
		return originalLoad(request, parent, isMain);
	};

	try {
		const usageDashboard = require("./views/usageDashboard") as typeof import("./views/usageDashboard");
		return {
			module: usageDashboard,
			warningCalls,
			stateUpdates,
			createProvider(initialRecords: UsageRecordForTest[] = []) {
				const context = {
					globalState: {
						get: () => initialRecords,
						update: async (key: string, value: unknown) => {
							stateUpdates.push({ key, value });
						},
					},
				};
				const provider = {
					onDidConsumeUsage: () => ({ dispose() {} }),
				};
				return new usageDashboard.InfiniAIUsageDashboardProvider(context as any, provider as any);
			},
		};
	} finally {
		Module._load = originalLoad;
	}
}

describe("usage dashboard", () => {
	const sampleRecords: UsageRecordForTest[] = [
		{
			ts: 1,
			modelId: "model-a",
			transport: "openai",
			inputTokens: 10,
			outputTokens: 5,
		},
	];

	it("confirms reset in the extension host before clearing local usage", async () => {
		const loaded = loadUsageDashboard({ warningResult: "Reset" });
		const dashboard = loaded.createProvider(sampleRecords);

		await (dashboard as any).handleMessage({ type: "reset" });

		assert.equal(loaded.warningCalls.length, 1);
		assert.equal(loaded.warningCalls[0][0], "Clear all locally recorded usage data?");
		assert.deepEqual(loaded.warningCalls[0][1], { modal: true });
		assert.equal(loaded.warningCalls[0][2], "Reset");
		assert.deepEqual(loaded.stateUpdates, [{ key: "infiniai.usageRecords.v1", value: [] }]);
	});

	it("keeps local usage when reset confirmation is cancelled", async () => {
		const loaded = loadUsageDashboard();
		const dashboard = loaded.createProvider(sampleRecords);

		await (dashboard as any).handleMessage({ type: "reset" });

		assert.equal(loaded.warningCalls.length, 1);
		assert.deepEqual(loaded.stateUpdates, []);
	});

	it("posts reset from the button without relying on browser confirm", () => {
		const loaded = loadUsageDashboard();
		const dashboard = loaded.createProvider();
		const html = (dashboard as any).renderHtml({ cspSource: "vscode-test" });

		assert.match(html, /vscode\.postMessage\(\{ type: 'reset' \}\)/);
		assert.doesNotMatch(html, /\bconfirm\(/);
	});
});
