import type { ModelTransport } from "./types";

export type DefaultThinkingState = "on" | "off" | "auto" | "forced" | "unknown";

export type CurrentTurnThinkingControlSpec =
	| { readonly kind: "none" }
	| { readonly kind: "qwen-enable-thinking" }
	| { readonly kind: "thinking-type" }
	| { readonly kind: "anthropic-thinking" };

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

export type ReplayRisk = "none" | "reasoning-content-required-after-tool-call" | "unknown";

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
}

export interface ResolveReasoningDialectProfileInput {
	readonly modelId: string;
	readonly transport: ModelTransport;
}

function normalizedModelId(modelId: string): string {
	return modelId.trim().toLowerCase();
}

function anthropicProfile(modelId: string): ReasoningDialectProfile {
	const isGlmDefaultThinking = /^glm-(5|4\.7)(\.|$|-)/.test(modelId) || modelId === "glm-5" || modelId === "glm-4.7";
	const isKimiForcedThinking = modelId.includes("kimi-k2-thinking");
	const isKimiDefaultThinking = !isKimiForcedThinking && modelId.includes("kimi-k2");
	return {
		id: modelId.includes("claude")
			? "anthropic-claude-compatible"
			: isGlmDefaultThinking
				? "glm-5-default-thinking"
				: isKimiForcedThinking
					? "kimi-k2-forced-thinking"
					: isKimiDefaultThinking
						? "kimi-k2-toggleable"
						: "anthropic-messages-compatible",
		transport: "anthropic",
		family: modelId.split(/[-_.]/)[0] || "anthropic",
		defaultThinking: isKimiForcedThinking ? "forced" : isGlmDefaultThinking || isKimiDefaultThinking ? "on" : "unknown",
		currentTurnControl: { kind: "none" },
		replayCarrier: "anthropic_thinking_block",
		preservationControl: { kind: "none" },
		canDisableThinking: false,
		canEnableThinking: false,
		replayRisk: "reasoning-content-required-after-tool-call",
	};
}

function openAIProfile(modelId: string): ReasoningDialectProfile {
	if (modelId.includes("minimax")) {
		return {
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
		};
	}

	if (modelId.includes("kimi-k2-thinking")) {
		return {
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
		};
	}

	if (modelId.includes("kimi-k2")) {
		return {
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
		};
	}

	if (/^glm-(5|4\.7)(\.|$|-)/.test(modelId) || modelId === "glm-5" || modelId === "glm-4.7") {
		return {
			id: "glm-5-default-thinking",
			transport: "openai",
			family: "glm",
			defaultThinking: "on",
			currentTurnControl: { kind: "thinking-type" },
			replayCarrier: "reasoning_content",
			preservationControl: { kind: "glm-clear-thinking" },
			canDisableThinking: true,
			canEnableThinking: true,
			replayRisk: "reasoning-content-required-after-tool-call",
		};
	}

	if (/^glm-4\.6(\.|$|-)/.test(modelId) || modelId === "glm-4.6") {
		return {
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
		};
	}

	if (modelId.startsWith("mimo-v2")) {
		return {
			id: "mimo-v2",
			transport: "openai",
			family: "mimo",
			defaultThinking: "unknown",
			currentTurnControl: { kind: "thinking-type" },
			replayCarrier: "reasoning_content",
			preservationControl: { kind: "none" },
			canDisableThinking: true,
			canEnableThinking: true,
			replayRisk: "reasoning-content-required-after-tool-call",
		};
	}

	if (modelId.startsWith("deepseek-v4")) {
		return {
			id: "deepseek-v4",
			transport: "openai",
			family: "deepseek",
			defaultThinking: "unknown",
			currentTurnControl: { kind: "thinking-type" },
			replayCarrier: "reasoning_content",
			preservationControl: { kind: "none" },
			canDisableThinking: true,
			canEnableThinking: true,
			replayRisk: "reasoning-content-required-after-tool-call",
		};
	}

	if (modelId.includes("qwen") && modelId.includes("vl")) {
		return {
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
		};
	}

	if (modelId.includes("qwen")) {
		const forcedThinking = modelId.includes("thinking") || modelId.includes("qwq");
		return {
			id: forcedThinking ? "qwen3-forced-thinking" : modelId.includes("instruct") ? "qwen3-instruct" : "qwen3-open-hybrid",
			transport: "openai",
			family: "qwen",
			defaultThinking: forcedThinking ? "forced" : modelId.includes("instruct") ? "off" : "unknown",
			currentTurnControl: forcedThinking ? { kind: "none" } : { kind: "qwen-enable-thinking" },
			replayCarrier: "reasoning_content",
			preservationControl: { kind: "qwen-preserve-thinking" },
			canDisableThinking: !forcedThinking,
			canEnableThinking: !forcedThinking,
			replayRisk: "reasoning-content-required-after-tool-call",
		};
	}

	return {
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
	};
}

export function resolveReasoningDialectProfile(
	input: ResolveReasoningDialectProfileInput
): ReasoningDialectProfile {
	const modelId = normalizedModelId(input.modelId);
	if (input.transport === "anthropic") {
		return anthropicProfile(modelId);
	}
	if (input.transport === "vertex") {
		return {
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
		};
	}
	return openAIProfile(modelId);
}
