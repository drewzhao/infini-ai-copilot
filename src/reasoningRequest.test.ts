import assert from "assert/strict";

import { applyReasoningRequestControls } from "./reasoningRequest";
import { resolveReasoningDialectProfile } from "./reasoningDialect";

describe("reasoning request controls", () => {
	it("disables Qwen thinking with enable_thinking only", () => {
		const body: Record<string, unknown> = { model: "qwen3-32b" };
		const profile = resolveReasoningDialectProfile({ modelId: "qwen3-32b", transport: "openai" });

		const result = applyReasoningRequestControls(body, profile, {
			thinkingMode: "disabled",
		});

		assert.deepEqual(body, {
			model: "qwen3-32b",
			enable_thinking: false,
		});
		assert.equal(result.currentTurnControlKind, "qwen-enable-thinking");
		assert.deepEqual(result.ignoredControls, []);
		assert.deepEqual(result.writtenFields, ["enable_thinking"]);
	});

	it("disables GLM thinking with thinking.type only", () => {
		const body: Record<string, unknown> = { model: "glm-5.1" };
		const profile = resolveReasoningDialectProfile({ modelId: "glm-5.1", transport: "openai" });

		applyReasoningRequestControls(body, profile, {
			thinkingMode: "disabled",
		});

		assert.deepEqual(body, {
			model: "glm-5.1",
			thinking: { type: "disabled" },
		});
		assert.equal((body as Record<string, unknown>).enable_thinking, undefined);
	});

	it("sets Kimi keep preservation without inventing Qwen fields", () => {
		const body: Record<string, unknown> = { model: "kimi-k2.6" };
		const profile = resolveReasoningDialectProfile({ modelId: "kimi-k2.6", transport: "openai" });

		applyReasoningRequestControls(body, profile, {
			thinkingMode: "enabled",
			preserveThinking: true,
		});

		assert.deepEqual(body, {
			model: "kimi-k2.6",
			thinking: { type: "enabled", keep: true },
		});
		assert.equal((body as Record<string, unknown>).enable_thinking, undefined);
	});

	it("sets GLM clear_thinking preservation controls", () => {
		const body: Record<string, unknown> = { model: "glm-5.1" };
		const profile = resolveReasoningDialectProfile({ modelId: "glm-5.1", transport: "openai" });

		applyReasoningRequestControls(body, profile, {
			preserveThinking: true,
		});

		assert.deepEqual(body, {
			model: "glm-5.1",
			thinking: { clear_thinking: false },
		});
	});

	it("sets Qwen preserve_thinking without thinking.type", () => {
		const body: Record<string, unknown> = { model: "qwen3-32b" };
		const profile = resolveReasoningDialectProfile({ modelId: "qwen3-32b", transport: "openai" });

		applyReasoningRequestControls(body, profile, {
			preserveThinking: true,
		});

		assert.deepEqual(body, {
			model: "qwen3-32b",
			preserve_thinking: true,
		});
		assert.equal((body as Record<string, unknown>).thinking, undefined);
	});

	it("selects MiniMax split mode without unsupported disable controls", () => {
		const body: Record<string, unknown> = { model: "minimax-m2.7" };
		const profile = resolveReasoningDialectProfile({ modelId: "minimax-m2.7", transport: "openai" });

		const result = applyReasoningRequestControls(body, profile, {
			thinkingMode: "disabled",
		});

		assert.deepEqual(body, {
			model: "minimax-m2.7",
			reasoning_split: true,
		});
		assert.deepEqual(result.ignoredControls, ["thinkingMode"]);
		assert.deepEqual(result.writtenFields, ["reasoning_split"]);
	});

	it("selects MiniMax split mode on Anthropic-compatible routes", () => {
		const body: Record<string, unknown> = { model: "minimax-m2.7" };
		const profile = resolveReasoningDialectProfile({ modelId: "minimax-m2.7", transport: "anthropic" });

		const result = applyReasoningRequestControls(body, profile, {});

		assert.deepEqual(body, {
			model: "minimax-m2.7",
			reasoning_split: true,
		});
		assert.deepEqual(result.ignoredControls, []);
		assert.deepEqual(result.writtenFields, ["reasoning_split"]);
	});

	it("does not send OpenAI-only controls to Anthropic Messages bodies", () => {
		const body: Record<string, unknown> = { model: "glm-5.1", max_tokens: 4096 };
		const profile = resolveReasoningDialectProfile({ modelId: "glm-5.1", transport: "anthropic" });

		const result = applyReasoningRequestControls(body, profile, {
			thinkingMode: "disabled",
			preserveThinking: true,
		});

		assert.deepEqual(body, { model: "glm-5.1", max_tokens: 4096 });
		assert.deepEqual(result.ignoredControls, ["thinkingMode", "preserveThinking"]);
		assert.equal((body as Record<string, unknown>).enable_thinking, undefined);
		assert.equal((body as Record<string, unknown>).thinking, undefined);
	});
});
