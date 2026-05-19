import assert from "assert/strict";

import { resolveReasoningDialectProfile } from "./reasoningDialect";

describe("reasoning dialect profiles", () => {
	it("resolves Qwen OpenAI routes to enable_thinking-only control", () => {
		const profile = resolveReasoningDialectProfile({
			modelId: "qwen3-32b",
			transport: "openai",
		});

		assert.equal(profile.id, "qwen3-open-hybrid");
		assert.equal(profile.currentTurnControl.kind, "qwen-enable-thinking");
		assert.equal(profile.replayCarrier, "reasoning_content");
		assert.equal(profile.canDisableThinking, true);
	});

	it("resolves GLM OpenAI routes to thinking.type with GLM preservation", () => {
		const profile = resolveReasoningDialectProfile({
			modelId: "glm-5.1",
			transport: "openai",
		});

		assert.equal(profile.id, "glm-5-default-thinking");
		assert.equal(profile.defaultThinking, "on");
		assert.equal(profile.currentTurnControl.kind, "thinking-type");
		assert.deepEqual(profile.preservationControl, { kind: "glm-clear-thinking" });
	});

	it("keeps Anthropic routed models away from OpenAI Chat Completions controls", () => {
		const profile = resolveReasoningDialectProfile({
			modelId: "glm-5.1",
			transport: "anthropic",
		});

		assert.equal(profile.id, "glm-5-default-thinking");
		assert.equal(profile.transport, "anthropic");
		assert.equal(profile.defaultThinking, "on");
		assert.equal(profile.currentTurnControl.kind, "none");
		assert.equal(profile.replayCarrier, "anthropic_thinking_block");
		assert.equal(profile.canDisableThinking, false);
	});

	it("does not claim MiniMax M2.7 thinking can be disabled", () => {
		const profile = resolveReasoningDialectProfile({
			modelId: "minimax-m2.7",
			transport: "openai",
		});

		assert.equal(profile.id, "minimax-m2");
		assert.equal(profile.currentTurnControl.kind, "none");
		assert.equal(profile.replayCarrier, "reasoning_details");
		assert.equal(profile.canDisableThinking, false);
	});
});
