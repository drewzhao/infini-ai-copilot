import type { ModelTransport } from "./types";

export type DefaultThinkingState = "on" | "off" | "auto" | "forced" | "unknown";

export type CurrentTurnThinkingControlSpec =
	| { readonly kind: "none" }
	| { readonly kind: "qwen-enable-thinking" }
	| { readonly kind: "thinking-type" }
	| {
			readonly kind: "anthropic-thinking";
			readonly enableMode?: "enabled" | "adaptive";
			readonly adaptiveDisplay?: "summarized" | "omitted";
	  };

export type ReplayCarrier =
	| "none"
	| "reasoning_content"
	| "reasoning_details"
	| "think_tag_content"
	| "anthropic_thinking_block"
	| "unknown";

export type ReplayPreservationControlSpec =
	| { readonly kind: "none" }
	| { readonly kind: "glm-clear-thinking" }
	| { readonly kind: "kimi-keep" }
	| { readonly kind: "qwen-preserve-thinking" };

export type ReplayRisk =
	| "none"
	| "reasoning-content-required-after-tool-call"
	| "reasoning-content-best-effort-after-tool-call"
	| "unknown";
export type ReasoningEffortControl = "none" | "openai-reasoning-effort" | "anthropic-output-config-effort";
export type ReasoningEffortLevel = "low" | "medium" | "high" | "max";
export type DefaultRequestThinkingMode = "enabled" | "disabled";

export interface ReasoningDialectProfile {
	readonly id: string;
	readonly transport: ModelTransport;
	readonly family: string;
	readonly defaultThinking: DefaultThinkingState;
	readonly currentTurnControl: CurrentTurnThinkingControlSpec;
	readonly replayCarrier: ReplayCarrier;
	readonly preservationControl: ReplayPreservationControlSpec;
	readonly canDisableThinking: boolean;
	readonly canEnableThinking: boolean;
	readonly replayRisk: ReplayRisk;
	readonly reasoningEffortControl: ReasoningEffortControl;
	readonly reasoningEffortLevels?: readonly ReasoningEffortLevel[];
	readonly defaultReasoningEffort?: ReasoningEffortLevel;
	readonly defaultRequestThinkingMode?: DefaultRequestThinkingMode;
}

export interface ResolveReasoningDialectProfileInput {
	readonly modelId: string;
	readonly transport: ModelTransport;
}

function normalizedModelId(modelId: string): string {
	return modelId.trim().toLowerCase();
}

type ReasoningDialectProfileInput = Omit<ReasoningDialectProfile, "reasoningEffortControl"> &
	Partial<Pick<ReasoningDialectProfile, "reasoningEffortControl">>;

function profile(input: ReasoningDialectProfileInput): ReasoningDialectProfile {
	return {
		reasoningEffortControl: "none",
		...input,
	};
}

const MIMO_OPENAI_REASONING_MODEL_IDS = new Set([
	"mimo-v2-pro",
	"mimo-v2-omni",
	"mimo-v2.5",
	"mimo-v2.5-pro",
	"mimo-v2.6-pro",
]);

function anthropicProfile(modelId: string): ReasoningDialectProfile {
	if (modelId.startsWith("deepseek-v3.2-thinking")) {
		return profile({
			id: "deepseek-v3.2-thinking-anthropic",
			transport: "anthropic",
			family: "deepseek",
			defaultThinking: "forced",
			currentTurnControl: { kind: "none" },
			replayCarrier: "anthropic_thinking_block",
			preservationControl: { kind: "none" },
			canDisableThinking: false,
			canEnableThinking: false,
			replayRisk: "reasoning-content-required-after-tool-call",
			reasoningEffortControl: "anthropic-output-config-effort",
		});
	}

	if (modelId.startsWith("deepseek-v3.2")) {
		return profile({
			id: "deepseek-v3.2-anthropic",
			transport: "anthropic",
			family: "deepseek",
			defaultThinking: "off",
			currentTurnControl: { kind: "anthropic-thinking" },
			replayCarrier: "anthropic_thinking_block",
			preservationControl: { kind: "none" },
			canDisableThinking: true,
			canEnableThinking: true,
			replayRisk: "reasoning-content-required-after-tool-call",
			reasoningEffortControl: "anthropic-output-config-effort",
		});
	}

	if (modelId.startsWith("deepseek-v4")) {
		return profile({
			id: "deepseek-v4-anthropic-safe-off",
			transport: "anthropic",
			family: "deepseek",
			defaultThinking: "off",
			defaultRequestThinkingMode: "disabled",
			currentTurnControl: { kind: "anthropic-thinking" },
			replayCarrier: "anthropic_thinking_block",
			preservationControl: { kind: "none" },
			canDisableThinking: true,
			canEnableThinking: false,
			replayRisk: "none",
		});
	}

	if (modelId.includes("kimi-k2")) {
		return profile({
			id: "kimi-k2-anthropic-safe-off",
			transport: "anthropic",
			family: "kimi",
			defaultThinking: "off",
			defaultRequestThinkingMode: "disabled",
			currentTurnControl: { kind: "anthropic-thinking" },
			replayCarrier: "anthropic_thinking_block",
			preservationControl: { kind: "none" },
			canDisableThinking: true,
			canEnableThinking: false,
			replayRisk: "none",
		});
	}

	if (modelId.includes("claude")) {
		return profile({
			id: "claude-anthropic-adaptive-thinking",
			transport: "anthropic",
			family: "claude",
			defaultThinking: "off",
			currentTurnControl: { kind: "anthropic-thinking", enableMode: "adaptive" },
			replayCarrier: "anthropic_thinking_block",
			preservationControl: { kind: "none" },
			canDisableThinking: true,
			canEnableThinking: true,
			replayRisk: "reasoning-content-required-after-tool-call",
		});
	}

	const isGlmDefaultThinking = /^glm-(5|4\.7)(\.|$|-)/.test(modelId) || modelId === "glm-5" || modelId === "glm-4.7";
	return profile({
		id: isGlmDefaultThinking ? "glm-5-default-thinking" : "anthropic-messages-compatible",
		transport: "anthropic",
		family: modelId.split(/[-_.]/)[0] || "anthropic",
		defaultThinking: isGlmDefaultThinking ? "on" : "unknown",
		currentTurnControl: { kind: "none" },
		replayCarrier: "anthropic_thinking_block",
		preservationControl: { kind: "none" },
		canDisableThinking: false,
		canEnableThinking: false,
		replayRisk: "reasoning-content-required-after-tool-call",
	});
}

function openAIProfile(modelId: string): ReasoningDialectProfile {
	if (modelId === "deepseek-r1") {
		return profile({
			id: "deepseek-r1-forced-reasoning",
			transport: "openai",
			family: "deepseek",
			defaultThinking: "forced",
			currentTurnControl: { kind: "none" },
			replayCarrier: "reasoning_content",
			preservationControl: { kind: "none" },
			canDisableThinking: false,
			canEnableThinking: false,
			replayRisk: "reasoning-content-required-after-tool-call",
		});
	}

	if (modelId.includes("minimax")) {
		return profile({
			id: modelId.includes("minimax-m2") ? "minimax-m2" : "minimax-reasoning-split",
			transport: "openai",
			family: "minimax",
			defaultThinking: "unknown",
			currentTurnControl: { kind: "none" },
			replayCarrier: "reasoning_details",
			preservationControl: { kind: "none" },
			canDisableThinking: false,
			canEnableThinking: false,
			replayRisk: "reasoning-content-required-after-tool-call",
		});
	}

	if (modelId.includes("kimi-k2-thinking")) {
		return profile({
			id: "kimi-k2-forced-thinking",
			transport: "openai",
			family: "kimi",
			defaultThinking: "forced",
			currentTurnControl: { kind: "none" },
			replayCarrier: "reasoning_content",
			preservationControl: { kind: "kimi-keep" },
			canDisableThinking: false,
			canEnableThinking: false,
			replayRisk: "reasoning-content-required-after-tool-call",
		});
	}

	if (modelId.includes("kimi-k2")) {
		return profile({
			id: "kimi-k2-toggleable",
			transport: "openai",
			family: "kimi",
			defaultThinking: "on",
			currentTurnControl: { kind: "thinking-type" },
			replayCarrier: "reasoning_content",
			preservationControl: { kind: "kimi-keep" },
			canDisableThinking: true,
			canEnableThinking: true,
			replayRisk: "reasoning-content-required-after-tool-call",
		});
	}

	if (/^glm-(5|4\.7)(\.|$|-)/.test(modelId) || modelId === "glm-5" || modelId === "glm-4.7") {
		return profile({
			id: "glm-5-default-thinking",
			transport: "openai",
			family: "glm",
			defaultThinking: "on",
			currentTurnControl: { kind: "thinking-type" },
			replayCarrier: "reasoning_content",
			preservationControl: { kind: "glm-clear-thinking" },
			canDisableThinking: true,
			canEnableThinking: true,
			replayRisk: "reasoning-content-best-effort-after-tool-call",
		});
	}

	if (/^glm-4\.6(\.|$|-)/.test(modelId) || modelId === "glm-4.6") {
		return profile({
			id: "glm-4-6-auto-thinking",
			transport: "openai",
			family: "glm",
			defaultThinking: "auto",
			currentTurnControl: { kind: "thinking-type" },
			replayCarrier: "reasoning_content",
			preservationControl: { kind: "glm-clear-thinking" },
			canDisableThinking: true,
			canEnableThinking: true,
			replayRisk: "reasoning-content-required-after-tool-call",
		});
	}

	if (MIMO_OPENAI_REASONING_MODEL_IDS.has(modelId)) {
		return profile({
			id: "mimo-v2-openai",
			transport: "openai",
			family: "mimo",
			defaultThinking: "unknown",
			currentTurnControl: { kind: "thinking-type" },
			replayCarrier: "reasoning_content",
			preservationControl: { kind: "none" },
			canDisableThinking: true,
			canEnableThinking: true,
			replayRisk: "reasoning-content-required-after-tool-call",
			reasoningEffortControl: "openai-reasoning-effort",
			defaultReasoningEffort: "high",
		});
	}

	if (modelId.startsWith("mimo-v2")) {
		return profile({
			id: "mimo-v2-openai-safe-off",
			transport: "openai",
			family: "mimo",
			defaultThinking: "off",
			defaultRequestThinkingMode: "disabled",
			currentTurnControl: { kind: "thinking-type" },
			replayCarrier: "reasoning_content",
			preservationControl: { kind: "none" },
			canDisableThinking: true,
			canEnableThinking: false,
			replayRisk: "none",
		});
	}

	if (modelId.startsWith("deepseek-v4")) {
		return profile({
			id: "deepseek-v4-openai",
			transport: "openai",
			family: "deepseek",
			defaultThinking: "unknown",
			currentTurnControl: { kind: "thinking-type" },
			replayCarrier: "reasoning_content",
			preservationControl: { kind: "none" },
			canDisableThinking: true,
			canEnableThinking: true,
			replayRisk: "reasoning-content-required-after-tool-call",
			reasoningEffortControl: "openai-reasoning-effort",
			reasoningEffortLevels: ["high", "max"],
			defaultReasoningEffort: "high",
		});
	}

	if (modelId.includes("qwen") && modelId.includes("vl")) {
		return profile({
			id: modelId.includes("thinking") ? "qwen3-vl-forced-thinking" : "qwen3-vl-hybrid",
			transport: "openai",
			family: "qwen-vl",
			defaultThinking: modelId.includes("thinking") ? "forced" : "unknown",
			currentTurnControl: modelId.includes("thinking") ? { kind: "none" } : { kind: "qwen-enable-thinking" },
			replayCarrier: "reasoning_content",
			preservationControl: { kind: "qwen-preserve-thinking" },
			canDisableThinking: !modelId.includes("thinking"),
			canEnableThinking: !modelId.includes("thinking"),
			replayRisk: "reasoning-content-required-after-tool-call",
		});
	}

	if (modelId.includes("qwen")) {
		const forcedThinking = modelId.includes("thinking") || modelId.includes("qwq");
		return profile({
			id: forcedThinking
				? "qwen3-forced-thinking"
				: modelId.includes("instruct")
					? "qwen3-instruct"
					: "qwen3-open-hybrid",
			transport: "openai",
			family: "qwen",
			defaultThinking: forcedThinking ? "forced" : modelId.includes("instruct") ? "off" : "unknown",
			currentTurnControl: forcedThinking ? { kind: "none" } : { kind: "qwen-enable-thinking" },
			replayCarrier: "reasoning_content",
			preservationControl: { kind: "qwen-preserve-thinking" },
			canDisableThinking: !forcedThinking,
			canEnableThinking: !forcedThinking,
			replayRisk: "reasoning-content-required-after-tool-call",
		});
	}

	return profile({
		id: "unknown",
		transport: "openai",
		family: "unknown",
		defaultThinking: "unknown",
		currentTurnControl: { kind: "none" },
		replayCarrier: "unknown",
		preservationControl: { kind: "none" },
		canDisableThinking: false,
		canEnableThinking: false,
		replayRisk: "unknown",
	});
}

export function resolveReasoningDialectProfile(input: ResolveReasoningDialectProfileInput): ReasoningDialectProfile {
	const modelId = normalizedModelId(input.modelId);
	if (input.transport === "anthropic") {
		return anthropicProfile(modelId);
	}
	if (input.transport === "vertex") {
		return profile({
			id: "vertex-generate-content",
			transport: "vertex",
			family: "vertex",
			defaultThinking: "unknown",
			currentTurnControl: { kind: "none" },
			replayCarrier: "unknown",
			preservationControl: { kind: "none" },
			canDisableThinking: false,
			canEnableThinking: false,
			replayRisk: "unknown",
		});
	}
	return openAIProfile(modelId);
}
