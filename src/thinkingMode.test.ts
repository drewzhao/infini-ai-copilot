import assert from "assert/strict";

import {
	DEFAULT_DISABLE_THINKING_PATTERNS,
	applyDisableThinking,
	shouldDisableThinking,
} from "./thinkingMode";

describe("shouldDisableThinking", () => {
	it("matches MiMo V2 default ids exactly", () => {
		for (const id of [
			"mimo-v2-pro",
			"mimo-v2.5-pro",
			"mimo-v2.5",
			"mimo-v2-omni",
			"mimo-v2-flash",
		]) {
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

describe("applyDisableThinking", () => {
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
