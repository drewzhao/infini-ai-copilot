import assert from "assert/strict";
import { readFileSync } from "fs";
import path from "path";

const Module = require("module") as any;

const DEFAULT_ROUND_TRIP_PATTERNS = [
	"mimo-v2*",
	"deepseek-v4*",
	"deepseek-r1",
	"deepseek-v3.2-thinking",
	"glm-5*",
	"glm-4.7*",
	"kimi-k2*",
	"minimax*",
];

function withVscodeMock<T>(configValues: Record<string, unknown>, fn: () => T): T {
	const originalLoad = Module._load;
	const vscodeMock = {
		workspace: {
			getConfiguration: () => ({
				get: (key: string, defaultValue?: unknown) => configValues[key] ?? defaultValue,
			}),
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

function loadThinkingMode(configValues: Record<string, unknown> = {}) {
	delete require.cache[require.resolve("./thinkingMode")];
	return withVscodeMock(configValues, () => require("./thinkingMode") as typeof import("./thinkingMode"));
}

describe("shouldDisableThinking", () => {
	const { DEFAULT_DISABLE_THINKING_PATTERNS, shouldDisableThinking } = loadThinkingMode();

	it("matches MiMo V2 default ids exactly", () => {
		for (const id of ["mimo-v2-pro", "mimo-v2.5-pro", "mimo-v2.5", "mimo-v2-omni", "mimo-v2-flash"]) {
			assert.equal(shouldDisableThinking(id, DEFAULT_DISABLE_THINKING_PATTERNS), true, id);
		}
	});

	it("matches DeepSeek V4 family via wildcard", () => {
		for (const id of ["deepseek-v4", "deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4-think-max"]) {
			assert.equal(shouldDisableThinking(id, DEFAULT_DISABLE_THINKING_PATTERNS), true, id);
		}
	});

	it("does not match unrelated DeepSeek versions", () => {
		for (const id of ["deepseek-v3", "deepseek-v3.1", "deepseek-r1", "deepseek-reasoner", "deepseek-chat"]) {
			assert.equal(shouldDisableThinking(id, DEFAULT_DISABLE_THINKING_PATTERNS), false, id);
		}
	});

	it("does not match unrelated MiMo or other vendors", () => {
		for (const id of ["mimo-v1", "kimi-k2-thinking", "qwen-3-coder", "gpt-4o"]) {
			assert.equal(shouldDisableThinking(id, DEFAULT_DISABLE_THINKING_PATTERNS), false, id);
		}
	});

	it("is case-insensitive", () => {
		assert.equal(shouldDisableThinking("MiMo-V2-Pro", DEFAULT_DISABLE_THINKING_PATTERNS), true);
		assert.equal(shouldDisableThinking("DeepSeek-V4-Pro", DEFAULT_DISABLE_THINKING_PATTERNS), true);
	});

	it("returns false for empty model id or empty pattern list", () => {
		assert.equal(shouldDisableThinking("", DEFAULT_DISABLE_THINKING_PATTERNS), false);
		assert.equal(shouldDisableThinking("mimo-v2-pro", []), false);
	});

	it("honors custom patterns from settings", () => {
		assert.equal(shouldDisableThinking("custom-thinker", ["custom-*"]), true);
		assert.equal(shouldDisableThinking("custom-thinker", ["other-*"]), false);
	});
});

describe("getDisableThinkingPatterns", () => {
	it("unions user-provided patterns with the built-in safety defaults", () => {
		const { getDisableThinkingPatterns, shouldDisableThinking } = loadThinkingMode({
			disableThinkingForModels: ["custom-*"],
		});

		const patterns = withVscodeMock({ disableThinkingForModels: ["custom-*"] }, getDisableThinkingPatterns);
		assert.equal(shouldDisableThinking("mimo-v2.5-pro", patterns), true);
		assert.equal(shouldDisableThinking("custom-thinker", patterns), true);
	});
});

describe("getThinkingRoundTripPatterns", () => {
	it("includes built-in replay-capable model family defaults", () => {
		const { DEFAULT_ENABLE_THINKING_ROUND_TRIP_PATTERNS, getThinkingRoundTripPatterns, shouldEnableThinkingRoundTrip } =
			loadThinkingMode();

		assert.deepEqual(DEFAULT_ENABLE_THINKING_ROUND_TRIP_PATTERNS, DEFAULT_ROUND_TRIP_PATTERNS);

		const patterns = withVscodeMock({}, getThinkingRoundTripPatterns);
		for (const id of [
			"mimo-v2.5-pro",
			"deepseek-v4-pro",
			"deepseek-r1",
			"deepseek-v3.2-thinking",
			"glm-5.1",
			"glm-4.7",
			"kimi-k2.6",
			"minimax-m2.7",
		]) {
			assert.equal(shouldEnableThinkingRoundTrip(id, patterns), true, id);
		}
		assert.equal(shouldEnableThinkingRoundTrip("deepseek-v3.2", patterns), false);
		assert.equal(shouldEnableThinkingRoundTrip("deepseek-r1-distill-qwen-32b", patterns), false);
		assert.equal(shouldEnableThinkingRoundTrip("pro-deepseek-r1", patterns), false);
		assert.equal(shouldEnableThinkingRoundTrip("qwen3-32b", patterns), false);
	});

	it("matches the manifest setting default", () => {
		const { DEFAULT_ENABLE_THINKING_ROUND_TRIP_PATTERNS } = loadThinkingMode();
		const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
		const manifestDefault =
			pkg.contributes?.configuration?.properties?.["infiniai.enableThinkingRoundTripForModels"]?.default;

		assert.deepEqual(manifestDefault, DEFAULT_ENABLE_THINKING_ROUND_TRIP_PATTERNS);
	});

	it("unions user round-trip patterns with the built-in defaults", () => {
		const { getThinkingRoundTripPatterns, shouldEnableThinkingRoundTrip } = loadThinkingMode();

		const patterns = withVscodeMock(
			{ enableThinkingRoundTripForModels: ["custom-thinker"] },
			getThinkingRoundTripPatterns
		);
		assert.equal(shouldEnableThinkingRoundTrip("mimo-v2.5-pro", patterns), true);
		assert.equal(shouldEnableThinkingRoundTrip("deepseek-v4", patterns), true);
		assert.equal(shouldEnableThinkingRoundTrip("custom-thinker", patterns), true);
	});
});

describe("getThinkingReplayStoreMode", () => {
	it("defaults to localPlaintext", () => {
		const { getThinkingReplayStoreMode } = loadThinkingMode();

		const mode = withVscodeMock({}, getThinkingReplayStoreMode);

		assert.equal(mode, "localPlaintext");
	});

	it("accepts only localPlaintext or memory", () => {
		const { getThinkingReplayStoreMode } = loadThinkingMode();

		assert.equal(withVscodeMock({ thinkingReplayStore: "memory" }, getThinkingReplayStoreMode), "memory");
		assert.equal(
			withVscodeMock({ thinkingReplayStore: "localPlaintext" }, getThinkingReplayStoreMode),
			"localPlaintext"
		);
		assert.equal(withVscodeMock({ thinkingReplayStore: "other" }, getThinkingReplayStoreMode), "localPlaintext");
	});
});

describe("applyDisableThinking", () => {
	const { applyDisableThinking } = loadThinkingMode();

	it("sets both enable_thinking:false and thinking.type:disabled", () => {
		const rb: Record<string, unknown> = { model: "mimo-v2-pro" };
		applyDisableThinking(rb);
		assert.equal(rb.enable_thinking, false);
		assert.deepEqual(rb.thinking, { type: "disabled" });
	});

	it("overrides any pre-existing thinking knobs", () => {
		const rb: Record<string, unknown> = {
			enable_thinking: true,
			thinking: { type: "enabled" },
			thinking_budget: 4096,
		};
		applyDisableThinking(rb);
		assert.equal(rb.enable_thinking, false);
		assert.deepEqual(rb.thinking, { type: "disabled" });
	});
});
