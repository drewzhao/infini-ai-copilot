import assert from "assert/strict";

const Module = require("module") as any;

function loadErrorActions() {
	const originalLoad = Module._load;
	const vscodeMock = {
		CancellationError: class CancellationError extends Error {},
		window: {
			showErrorMessage: async () => undefined,
			showWarningMessage: async () => undefined,
		},
		commands: {
			executeCommand: async () => undefined,
		},
		env: {
			openExternal: async () => undefined,
		},
		Uri: {
			parse: (value: string) => value,
		},
		l10n: {
			t: (message: string, ...args: unknown[]) =>
				args.length === 0 ? message : message.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)])),
		},
	};
	for (const id of ["./utils", "./errorActions"]) {
		delete require.cache[require.resolve(id)];
	}
	Module._load = (request: string, parent: unknown, isMain: boolean) => {
		if (request === "vscode") {
			return vscodeMock;
		}
		return originalLoad(request, parent, isMain);
	};
	try {
		return {
			utils: require("./utils") as typeof import("./utils"),
			actions: require("./errorActions") as typeof import("./errorActions"),
		};
	} finally {
		Module._load = originalLoad;
	}
}

describe("InfiniAI actionable error classification", () => {
	it("treats the live 503 Wrong Bearer Token response as an authentication rejection", () => {
		const { actions, utils } = loadErrorActions();
		const error = new utils.HttpError(
			503,
			"Service Unavailable",
			'{"code":60000,"msg":"Wrong Bearer Token"}'
		);

		assert.equal(actions.categorizeError(error)?.category, "auth");
	});

	it("treats the live localized invalid-key response as an authentication rejection", () => {
		const { actions, utils } = loadErrorActions();
		const error = new utils.HttpError(401, "Unauthorized", '{"code":10009,"msg":"请使用正确的api key进行请求"}');

		assert.equal(actions.categorizeError(error)?.category, "auth");
	});

	it("keeps an unrelated 503 in the server category", () => {
		const { actions, utils } = loadErrorActions();
		const error = new utils.HttpError(503, "Service Unavailable", "upstream unavailable");

		assert.equal(actions.categorizeError(error)?.category, "server");
	});
});
