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
		assert.equal(String(profile.replayRisk), "reasoning-content-best-effort-after-tool-call");
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

	it("resolves DeepSeek R1 OpenAI routes as forced reasoning replay without toggle controls", () => {
		const profile = resolveReasoningDialectProfile({
			modelId: "deepseek-r1",
			transport: "openai",
		});

		assert.equal(profile.id, "deepseek-r1-forced-reasoning");
		assert.equal(profile.transport, "openai");
		assert.equal(profile.defaultThinking, "forced");
		assert.equal(profile.currentTurnControl.kind, "none");
		assert.equal(profile.replayCarrier, "reasoning_content");
		assert.equal(profile.canDisableThinking, false);
		assert.equal(profile.canEnableThinking, false);
		assert.equal(profile.reasoningEffortControl, "none");
		assert.equal(profile.replayRisk, "reasoning-content-required-after-tool-call");
	});

	it("resolves DeepSeek V4 OpenAI routes as toggleable reasoning with default high effort", () => {
		const profile = resolveReasoningDialectProfile({
			modelId: "deepseek-v4-pro",
			transport: "openai",
		});

		assert.equal(profile.id, "deepseek-v4-openai");
		assert.equal(profile.transport, "openai");
		assert.equal(profile.defaultThinking, "unknown");
		assert.equal(profile.currentTurnControl.kind, "thinking-type");
		assert.equal(profile.replayCarrier, "reasoning_content");
		assert.equal(profile.canDisableThinking, true);
		assert.equal(profile.canEnableThinking, true);
		assert.equal(profile.reasoningEffortControl, "openai-reasoning-effort");
		assert.equal(profile.defaultReasoningEffort, "high");
		assert.equal(profile.replayRisk, "reasoning-content-best-effort-after-tool-call");
	});

	it("resolves DeepSeek V3.2 Anthropic routes as toggleable default-off thinking", () => {
		const profile = resolveReasoningDialectProfile({
			modelId: "deepseek-v3.2",
			transport: "anthropic",
		});

		assert.equal(profile.id, "deepseek-v3.2-anthropic");
		assert.equal(profile.transport, "anthropic");
		assert.equal(profile.defaultThinking, "off");
		assert.equal(profile.currentTurnControl.kind, "anthropic-thinking");
		assert.equal(profile.replayCarrier, "anthropic_thinking_block");
		assert.equal(profile.canDisableThinking, true);
		assert.equal(profile.canEnableThinking, true);
		assert.equal(profile.reasoningEffortControl, "anthropic-output-config-effort");
		assert.equal(profile.replayRisk, "reasoning-content-required-after-tool-call");
	});

	it("resolves DeepSeek V3.2 thinking Anthropic routes as forced thinking without disable controls", () => {
		const profile = resolveReasoningDialectProfile({
			modelId: "deepseek-v3.2-thinking",
			transport: "anthropic",
		});

		assert.equal(profile.id, "deepseek-v3.2-thinking-anthropic");
		assert.equal(profile.defaultThinking, "forced");
		assert.equal(profile.currentTurnControl.kind, "none");
		assert.equal(profile.replayCarrier, "anthropic_thinking_block");
		assert.equal(profile.canDisableThinking, false);
		assert.equal(profile.canEnableThinking, false);
		assert.equal(profile.reasoningEffortControl, "anthropic-output-config-effort");
	});

	it("resolves DeepSeek V4 Anthropic routes as safe-off because thinking plus tools is malformed", () => {
		const profile = resolveReasoningDialectProfile({
			modelId: "deepseek-v4-flash",
			transport: "anthropic",
		});

		assert.equal(profile.id, "deepseek-v4-anthropic-safe-off");
		assert.equal(profile.defaultThinking, "off");
		assert.equal(profile.defaultRequestThinkingMode, "disabled");
		assert.equal(profile.currentTurnControl.kind, "anthropic-thinking");
		assert.equal(profile.replayCarrier, "anthropic_thinking_block");
		assert.equal(profile.canDisableThinking, true);
		assert.equal(profile.canEnableThinking, false);
		assert.equal(profile.reasoningEffortControl, "none");
		assert.equal(profile.replayRisk, "none");
	});

	it("resolves manual Kimi Anthropic routes as safe-off without enable or effort controls", () => {
		const profile = resolveReasoningDialectProfile({
			modelId: "kimi-k2.6",
			transport: "anthropic",
		});

		assert.equal(profile.id, "kimi-k2-anthropic-safe-off");
		assert.equal(profile.transport, "anthropic");
		assert.equal(profile.family, "kimi");
		assert.equal(profile.defaultThinking, "off");
		assert.equal(profile.defaultRequestThinkingMode, "disabled");
		assert.equal(profile.currentTurnControl.kind, "anthropic-thinking");
		assert.equal(profile.replayCarrier, "anthropic_thinking_block");
		assert.equal(profile.preservationControl.kind, "none");
		assert.equal(profile.canDisableThinking, true);
		assert.equal(profile.canEnableThinking, false);
		assert.equal(profile.reasoningEffortControl, "none");
		assert.equal(profile.replayRisk, "none");
	});

	it("resolves Kimi K2 OpenAI routes as best-effort reasoning replay profiles", () => {
		for (const modelId of ["kimi-k2.6", "kimi-k2-thinking"]) {
			const profile = resolveReasoningDialectProfile({
				modelId,
				transport: "openai",
			});

			assert.equal(profile.transport, "openai");
			assert.equal(profile.family, "kimi");
			assert.equal(profile.replayCarrier, "reasoning_content");
			assert.deepEqual(profile.preservationControl, { kind: "kimi-keep" });
			assert.equal(profile.reasoningEffortControl, "none");
			assert.equal(profile.replayRisk, "reasoning-content-best-effort-after-tool-call");
		}
	});

	it("resolves confirmed Claude Anthropic adaptive-thinking model IDs as adaptive profiles", () => {
		for (const modelId of ["claude-opus-4-6", "claude-opus-4-7", "claude-sonnet-4-6"]) {
			const profile = resolveReasoningDialectProfile({
				modelId,
				transport: "anthropic",
			});

			assert.equal(profile.id, "claude-anthropic-adaptive-thinking");
			assert.equal(profile.transport, "anthropic");
			assert.equal(profile.family, "claude");
			assert.equal(profile.defaultThinking, "off");
			assert.deepEqual(profile.currentTurnControl, {
				kind: "anthropic-thinking",
				enableMode: "adaptive",
			});
			assert.equal(profile.replayCarrier, "anthropic_thinking_block");
			assert.equal(profile.canDisableThinking, true);
			assert.equal(profile.canEnableThinking, true);
			assert.equal(profile.reasoningEffortControl, "none");
			assert.equal(profile.replayRisk, "reasoning-content-required-after-tool-call");
		}
	});

	it("resolves Claude Sonnet 4.5 Anthropic routes as budgeted extended-thinking profiles", () => {
		const profile = resolveReasoningDialectProfile({
			modelId: "claude-sonnet-4-5-20250929",
			transport: "anthropic",
		});

		assert.equal(profile.id, "claude-anthropic-budgeted-thinking");
		assert.equal(profile.transport, "anthropic");
		assert.equal(profile.family, "claude");
		assert.equal(profile.defaultThinking, "off");
		assert.deepEqual(profile.currentTurnControl, {
			kind: "anthropic-thinking",
			enableMode: "enabled",
		});
		assert.equal(profile.replayCarrier, "anthropic_thinking_block");
		assert.equal(profile.canDisableThinking, true);
		assert.equal(profile.canEnableThinking, true);
		assert.equal(profile.reasoningEffortControl, "none");
		assert.equal(profile.replayRisk, "reasoning-content-required-after-tool-call");
	});

	it("keeps unknown Claude Anthropic model IDs away from optimistic thinking controls", () => {
		const profile = resolveReasoningDialectProfile({
			modelId: "claude-future-experimental",
			transport: "anthropic",
		});

		assert.equal(profile.id, "claude-anthropic-unknown");
		assert.equal(profile.transport, "anthropic");
		assert.equal(profile.family, "claude");
		assert.equal(profile.currentTurnControl.kind, "none");
		assert.equal(profile.replayCarrier, "anthropic_thinking_block");
		assert.equal(profile.canDisableThinking, false);
		assert.equal(profile.canEnableThinking, false);
		assert.equal(profile.reasoningEffortControl, "none");
		assert.equal(profile.replayRisk, "unknown");
	});

	it("resolves OpenClaw-confirmed MiMo OpenAI reasoning IDs with effort and replay controls", () => {
		for (const modelId of ["mimo-v2-pro", "mimo-v2-omni", "mimo-v2.5", "mimo-v2.5-pro", "mimo-v2.6-pro"]) {
			const profile = resolveReasoningDialectProfile({
				modelId,
				transport: "openai",
			});

			assert.equal(profile.id, "mimo-v2-openai");
			assert.equal(profile.transport, "openai");
			assert.equal(profile.family, "mimo");
			assert.equal(profile.defaultThinking, "unknown");
			assert.equal(profile.currentTurnControl.kind, "thinking-type");
			assert.equal(profile.replayCarrier, "reasoning_content");
			assert.equal(profile.canDisableThinking, true);
			assert.equal(profile.canEnableThinking, true);
			assert.equal(profile.reasoningEffortControl, "openai-reasoning-effort");
			assert.equal(profile.defaultReasoningEffort, "high");
			assert.equal(profile.replayRisk, "reasoning-content-required-after-tool-call");
		}
	});

	it("keeps unprobed MiMo V2 OpenAI variants safe-off", () => {
		const profile = resolveReasoningDialectProfile({
			modelId: "mimo-v2-flash",
			transport: "openai",
		});

		assert.equal(profile.id, "mimo-v2-openai-safe-off");
		assert.equal(profile.family, "mimo");
		assert.equal(profile.defaultThinking, "off");
		assert.equal(profile.defaultRequestThinkingMode, "disabled");
		assert.equal(profile.currentTurnControl.kind, "thinking-type");
		assert.equal(profile.replayCarrier, "reasoning_content");
		assert.equal(profile.canDisableThinking, true);
		assert.equal(profile.canEnableThinking, false);
		assert.equal(profile.reasoningEffortControl, "none");
		assert.equal(profile.replayRisk, "none");
	});
});
