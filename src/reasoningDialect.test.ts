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
		assert.equal(profile.reasoningEffortControl, "none");
	});

	it("resolves GLM 5.2 OpenAI routes with provider-specific reasoning effort", () => {
		const profile = resolveReasoningDialectProfile({
			modelId: "glm-5.2",
			transport: "openai",
		});

		assert.equal(profile.id, "glm-5.2-openai");
		assert.equal(profile.defaultThinking, "on");
		assert.equal(profile.currentTurnControl.kind, "thinking-type");
		assert.deepEqual(profile.preservationControl, { kind: "glm-clear-thinking" });
		assert.equal(profile.reasoningEffortControl, "openai-reasoning-effort");
		assert.deepEqual(profile.reasoningEffortLevels, ["high", "max"]);
		assert.equal(profile.defaultReasoningEffort, "max");
		assert.equal(profile.replayRisk, "reasoning-content-best-effort-after-tool-call");
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

	it("resolves verified DeepSeek V4 OpenAI routes without forcing a reasoning effort", () => {
		for (const modelId of ["deepseek-v4-pro", "deepseek-v4-flash"]) {
			const profile = resolveReasoningDialectProfile({
				modelId,
				transport: "openai",
			});

			assert.equal(profile.id, "deepseek-v4-openai", modelId);
			assert.equal(profile.transport, "openai", modelId);
			assert.equal(profile.defaultThinking, "unknown", modelId);
			assert.equal(profile.currentTurnControl.kind, "thinking-type", modelId);
			assert.equal(profile.replayCarrier, "reasoning_content", modelId);
			assert.equal(profile.canDisableThinking, true, modelId);
			assert.equal(profile.canEnableThinking, true, modelId);
			assert.equal(profile.reasoningEffortControl, "openai-reasoning-effort", modelId);
			assert.equal(profile.defaultReasoningEffort, undefined, modelId);
			assert.equal(profile.requiredToolChoiceControl, "required-string", modelId);
			assert.equal(profile.replayRisk, "reasoning-content-best-effort-after-tool-call", modelId);
		}
	});

	it("keeps unverified DeepSeek V4 OpenAI variants safe-off", () => {
		const profile = resolveReasoningDialectProfile({
			modelId: "deepseek-v4-experimental",
			transport: "openai",
		});

		assert.equal(profile.id, "deepseek-v4-openai-safe-off");
		assert.equal(profile.defaultThinking, "off");
		assert.equal(profile.defaultRequestThinkingMode, "disabled");
		assert.equal(profile.currentTurnControl.kind, "thinking-type");
		assert.equal(profile.canDisableThinking, true);
		assert.equal(profile.canEnableThinking, false);
		assert.equal(profile.reasoningEffortControl, "none");
		assert.equal(profile.requiredToolChoiceControl, "required-string");
		assert.equal(profile.replayRisk, "none");
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

	it("keeps Kimi K2.5 toggleable without claiming preserved-thinking support", () => {
		const profile = resolveReasoningDialectProfile({ modelId: "kimi-k2.5", transport: "openai" });

		assert.equal(profile.id, "kimi-k2.5-toggleable");
		assert.equal(profile.family, "kimi");
		assert.equal(profile.currentTurnControl.kind, "thinking-type");
		assert.equal(profile.preservationControl.kind, "none");
		assert.equal(profile.replayScope, "tool-call-assistant-messages");
		assert.equal(profile.canDisableThinking, true);
		assert.equal(profile.requiredToolChoiceControl, "unsupported");
	});

	it("resolves Kimi K2.6 as toggleable with optional whole-history preservation", () => {
		const profile = resolveReasoningDialectProfile({ modelId: "kimi-k2.6", transport: "openai" });

		assert.equal(profile.id, "kimi-k2.6-toggleable-preserved");
		assert.equal(profile.defaultThinking, "on");
		assert.equal(profile.currentTurnControl.kind, "thinking-type");
		assert.deepEqual(profile.preservationControl, { kind: "kimi-keep-all" });
		assert.equal(profile.replayScope, "all-assistant-messages");
		assert.equal(profile.replayRequiredByDefault, false);
		assert.equal(profile.replayRisk, "reasoning-content-required-for-all-assistant-messages");
		assert.equal(profile.requiredToolChoiceControl, "unsupported");
	});

	it("resolves both Kimi K2.7 Code speeds as forced preserved-thinking profiles", () => {
		for (const modelId of ["kimi-k2.7-code", "kimi-k2.7-code-highspeed"]) {
			const profile = resolveReasoningDialectProfile({ modelId, transport: "openai" });

			assert.equal(profile.id, "kimi-k2.7-code-forced-preserved");
			assert.equal(profile.defaultThinking, "forced");
			assert.equal(profile.currentTurnControl.kind, "none");
			assert.equal(profile.preservationControl.kind, "always-preserved");
			assert.equal(profile.replayScope, "all-assistant-messages");
			assert.equal(profile.replayRequiredByDefault, true);
			assert.equal(profile.canDisableThinking, false);
			assert.equal(profile.reasoningEffortControl, "none");
			assert.equal(profile.requiredToolChoiceControl, "unsupported");
		}
	});

	it("resolves Kimi K3 with forced preserved thinking and K3 effort/tool controls", () => {
		const profile = resolveReasoningDialectProfile({ modelId: "kimi-k3", transport: "openai" });

		assert.equal(profile.id, "kimi-k3-forced-preserved");
		assert.equal(profile.defaultThinking, "forced");
		assert.equal(profile.currentTurnControl.kind, "none");
		assert.equal(profile.preservationControl.kind, "always-preserved");
		assert.equal(profile.replayScope, "all-assistant-messages");
		assert.equal(profile.replayRequiredByDefault, true);
		assert.equal(profile.allowsMissingReplayPayload, true);
		assert.equal(profile.reasoningEffortControl, "openai-reasoning-effort");
		assert.deepEqual(profile.reasoningEffortLevels, ["low", "high", "max"]);
		assert.equal(profile.defaultReasoningEffort, "max");
		assert.equal(profile.requiredToolChoiceControl, "required-string");
	});

	it("keeps legacy and unverified Kimi IDs out of the active K2.x profiles", () => {
		const legacy = resolveReasoningDialectProfile({ modelId: "kimi-k2-thinking", transport: "openai" });
		assert.equal(legacy.id, "kimi-k2-thinking-legacy");
		assert.equal(legacy.preservationControl.kind, "none");

		for (const modelId of ["kimi-k2.7-code-test", "kimi-k2-instruct", "kimi-k3-test"]) {
			assert.equal(resolveReasoningDialectProfile({ modelId, transport: "openai" }).id, "unknown", modelId);
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
