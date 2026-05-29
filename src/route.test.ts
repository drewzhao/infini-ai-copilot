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
	it("uses built-in catalog endpoint metadata for known Claude-compatible models", () => {
		const route = loadRoute({
			"infiniai.plan": "standard",
			"infiniai.anthropic.baseUrl": "https://anthropic.example",
		});
		const { enrichModelWithBuiltInMetadata } = require("./catalogMetadata") as typeof import("./catalogMetadata");

		const result = route.resolveModelRoute(
			enrichModelWithBuiltInMetadata({ id: "deepseek-v4-pro", object: "model", created: 1, owned_by: "infini" }),
			[]
		);

		assert.equal(result.transport, "anthropic");
		assert.equal(result.endpointKind, "messages");
		assert.equal(result.baseUrl, "https://anthropic.example");
		assert.equal(result.source, "metadata");
	});

	it("routes GLM catalog models like the bundled OpenClaw Z.AI provider", () => {
		const route = loadRoute({
			"infiniai.plan": "standard",
			"infiniai.baseUrl": "https://openai.example/v1",
			"infiniai.anthropic.baseUrl": "https://anthropic.example",
		});
		const { enrichModelWithBuiltInMetadata } = require("./catalogMetadata") as typeof import("./catalogMetadata");

		const result = route.resolveModelRoute(
			enrichModelWithBuiltInMetadata({ id: "glm-5.1", object: "model", created: 1, owned_by: "infini" }),
			[]
		);

		assert.equal(result.transport, "openai");
		assert.equal(result.endpointKind, "chat.completions");
		assert.equal(result.baseUrl, "https://openai.example/v1");
		assert.equal(result.source, "metadata");
	});

	it("prefers OpenAI-compatible routing for Kimi K2 defaults even when catalog metadata says Anthropic", () => {
		const route = loadRoute({
			"infiniai.plan": "standard",
			"infiniai.baseUrl": "https://openai.example/v1",
			"infiniai.anthropic.baseUrl": "https://anthropic.example",
		});
		const { enrichModelWithBuiltInMetadata } = require("./catalogMetadata") as typeof import("./catalogMetadata");

		const result = route.resolveModelRoute(
			enrichModelWithBuiltInMetadata({ id: "kimi-k2.6", object: "model", created: 1, owned_by: "infini" }),
			[]
		);

		assert.equal(result.transport, "openai");
		assert.equal(result.endpointKind, "chat.completions");
		assert.equal(result.baseUrl, "https://openai.example/v1");
		assert.equal(result.source, "catalog");
	});

	it("prefers OpenAI-compatible routing for MiMo defaults even when catalog metadata says Anthropic", () => {
		const route = loadRoute({
			"infiniai.plan": "standard",
			"infiniai.baseUrl": "https://openai.example/v1",
			"infiniai.anthropic.baseUrl": "https://anthropic.example",
		});
		const { enrichModelWithBuiltInMetadata } = require("./catalogMetadata") as typeof import("./catalogMetadata");

		const result = route.resolveModelRoute(
			enrichModelWithBuiltInMetadata({ id: "mimo-v2.5-pro", object: "model", created: 1, owned_by: "infini" }),
			[]
		);

		assert.equal(result.transport, "openai");
		assert.equal(result.endpointKind, "chat.completions");
		assert.equal(result.baseUrl, "https://openai.example/v1");
		assert.equal(result.source, "catalog");
	});

	it("still lets user route overrides send Kimi K2 through Anthropic Messages", () => {
		const route = loadRoute({
			"infiniai.plan": "standard",
			"infiniai.baseUrl": "https://openai.example/v1",
			"infiniai.anthropic.baseUrl": "https://anthropic.example",
		});
		const { enrichModelWithBuiltInMetadata } = require("./catalogMetadata") as typeof import("./catalogMetadata");

		const result = route.resolveModelRoute(
			enrichModelWithBuiltInMetadata({ id: "kimi-k2.6", object: "model", created: 1, owned_by: "infini" }),
			[{ pattern: "kimi-k2.6", transport: "anthropic" }]
		);

		assert.equal(result.transport, "anthropic");
		assert.equal(result.endpointKind, "messages");
		assert.equal(result.baseUrl, "https://anthropic.example");
		assert.equal(result.source, "user");
	});

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

	it("matches exact route overrides before catalog metadata", () => {
		const route = loadRoute({
			"infiniai.plan": "standard",
			"infiniai.baseUrl": "https://openai.example/v1",
			"infiniai.anthropic.baseUrl": "https://anthropic.example",
		});
		const { enrichModelWithBuiltInMetadata } = require("./catalogMetadata") as typeof import("./catalogMetadata");

		const result = route.resolveModelRoute(
			enrichModelWithBuiltInMetadata({ id: "deepseek-v4-pro", object: "model", created: 1, owned_by: "infini" }),
			[{ pattern: "deepseek-v4-pro", transport: "openai" }]
		);

		assert.equal(result.transport, "openai");
		assert.equal(result.endpointKind, "chat.completions");
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

	it("counts valid and exact route overrides", () => {
		const route = loadRoute({});

		assert.deepEqual(
			route.countModelRouteOverrides([
				{ pattern: "mimo-v2-pro", transport: "openai" },
				{ pattern: "mimo-*", transport: "anthropic" },
				{ pattern: "*", transport: "openai" },
				{ pattern: "bad", transport: "unknown" },
			]),
			{ routeConfigCount: 3, exactModelRouteOverrideCount: 1 }
		);
	});

	it("creates an exact model route override", () => {
		const route = loadRoute({});

		assert.deepEqual(route.setExactModelRouteOverride([], "mimo-v2-pro", "openai"), [
			{ pattern: "mimo-v2-pro", transport: "openai" },
		]);
	});

	it("updates and deduplicates exact model route overrides", () => {
		const route = loadRoute({});

		assert.deepEqual(
			route.setExactModelRouteOverride(
				[
					{ pattern: "mimo-v2-pro", transport: "anthropic", baseUrl: "https://anthropic.example" },
					{ pattern: "mimo-v2-pro", transport: "openai" },
					{ pattern: "kimi-*", transport: "anthropic" },
				],
				"mimo-v2-pro",
				"openai"
			),
			[
				{ pattern: "mimo-v2-pro", transport: "openai" },
				{ pattern: "kimi-*", transport: "anthropic" },
			]
		);
	});

	it("inserts exact overrides before broader matching wildcards", () => {
		const route = loadRoute({});

		assert.deepEqual(
			route.setExactModelRouteOverride(
				[
					{ pattern: "deepseek-v4-*", transport: "anthropic" },
					{ pattern: "mimo-*", transport: "openai" },
				],
				"mimo-v2-pro",
				"anthropic"
			),
			[
				{ pattern: "deepseek-v4-*", transport: "anthropic" },
				{ pattern: "mimo-v2-pro", transport: "anthropic" },
				{ pattern: "mimo-*", transport: "openai" },
			]
		);
	});

	it("preserves unrelated manual route entries", () => {
		const route = loadRoute({});
		const invalid = { pattern: "manual", transport: "custom", note: "keep me" };

		assert.deepEqual(route.setExactModelRouteOverride([invalid], "mimo-v2-pro", "openai"), [
			invalid,
			{ pattern: "mimo-v2-pro", transport: "openai" },
		]);
	});

	it("resets exact overrides without removing wildcard behavior", () => {
		const route = loadRoute({
			"infiniai.plan": "standard",
			"infiniai.baseUrl": "https://openai.example/v1",
			"infiniai.anthropic.baseUrl": "https://anthropic.example",
		});
		const routes = route.resetExactModelRouteOverride(
			[
				{ pattern: "mimo-v2-pro", transport: "anthropic" },
				{ pattern: "mimo-*", transport: "openai" },
			],
			"mimo-v2-pro"
		);

		assert.deepEqual(routes, [{ pattern: "mimo-*", transport: "openai" }]);
		const result = route.resolveModelRoute(
			{ id: "mimo-v2-pro", object: "model", created: 1, owned_by: "infini", apiMode: "anthropic" },
			route.parseModelRouteConfigs(routes)
		);
		assert.equal(result.transport, "openai");
		assert.equal(result.source, "user");
	});

	it("returns Claude-compatible catalog models to metadata routing after exact reset", () => {
		const route = loadRoute({
			"infiniai.plan": "standard",
			"infiniai.anthropic.baseUrl": "https://anthropic.example",
		});
		const { enrichModelWithBuiltInMetadata } = require("./catalogMetadata") as typeof import("./catalogMetadata");
		const routes = route.resetExactModelRouteOverride(
			[{ pattern: "deepseek-v4-pro", transport: "openai" }],
			"deepseek-v4-pro"
		);

		const result = route.resolveModelRoute(
			enrichModelWithBuiltInMetadata({ id: "deepseek-v4-pro", object: "model", created: 1, owned_by: "infini" }),
			route.parseModelRouteConfigs(routes)
		);

		assert.equal(result.transport, "anthropic");
		assert.equal(result.source, "metadata");
	});
});
