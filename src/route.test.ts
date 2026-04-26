import assert from "assert/strict";

const Module = require("module") as any;

function loadRoute(configValues: Record<string, unknown>) {
	const originalLoad = Module._load;
	const vscodeMock = {
		workspace: {
			getConfiguration: () => ({
				get: (key: string, defaultValue?: unknown) => configValues[key] ?? defaultValue,
			}),
		},
	};
	delete require.cache[require.resolve("./utils")];
	delete require.cache[require.resolve("./route")];
	Module._load = (request: string, parent: unknown, isMain: boolean) => {
		if (request === "vscode") {
			return vscodeMock;
		}
		return originalLoad(request, parent, isMain);
	};
	try {
		return require("./route") as typeof import("./route");
	} finally {
		Module._load = originalLoad;
	}
}

describe("model routing", () => {
	it("matches wildcard route overrides before metadata", () => {
		const route = loadRoute({
			"infiniai.plan": "standard",
			"infiniai.baseUrl": "https://openai.example/v1",
			"infiniai.anthropic.baseUrl": "https://anthropic.example",
		});

		const result = route.resolveModelRoute(
			{ id: "claude-test", object: "model", created: 1, owned_by: "infini", apiMode: "openai" },
			[{ pattern: "claude-*", transport: "anthropic", baseUrl: "https://override.example" }]
		);

		assert.equal(result.transport, "anthropic");
		assert.equal(result.endpointKind, "messages");
		assert.equal(result.baseUrl, "https://override.example");
		assert.equal(result.source, "user");
	});

	it("falls back to OpenAI-compatible routing", () => {
		const route = loadRoute({
			"infiniai.plan": "standard",
			"infiniai.baseUrl": "https://openai.example/v1",
		});

		const result = route.resolveModelRoute({ id: "generic-chat", object: "model", created: 1, owned_by: "infini" }, []);

		assert.equal(result.transport, "openai");
		assert.equal(result.endpointKind, "chat.completions");
		assert.equal(result.baseUrl, "https://openai.example/v1");
	});

	it("parses only valid user route configs", () => {
		const route = loadRoute({});
		assert.deepEqual(
			route.parseModelRouteConfigs([
				{ pattern: "claude-*", transport: "anthropic" },
				{ pattern: "", transport: "openai" },
				{ pattern: "bad", transport: "unknown" },
			]),
			[{ pattern: "claude-*", transport: "anthropic", baseUrl: undefined }]
		);
	});
});
