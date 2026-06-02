import type { InfiniAIModelConfiguration } from "./modelConfiguration";
import type { ReasoningDialectProfile } from "./reasoningDialect";

export function getDefaultRequestThinkingMode(input: {
	readonly profile: ReasoningDialectProfile;
	readonly configuredThinkingMode?: InfiniAIModelConfiguration["thinkingMode"];
}): InfiniAIModelConfiguration["thinkingMode"] | undefined {
	const { profile, configuredThinkingMode } = input;
	if (!profile.defaultRequestThinkingMode) {
		return undefined;
	}
	if (configuredThinkingMode === "enabled" && profile.canEnableThinking) {
		return undefined;
	}
	if (configuredThinkingMode === "disabled" && profile.canDisableThinking) {
		return undefined;
	}
	return profile.defaultRequestThinkingMode;
}

export function shouldHonorThinkingRoundTripForProfile(input: {
	readonly profile: ReasoningDialectProfile;
	readonly configuredThinkingMode?: InfiniAIModelConfiguration["thinkingMode"];
}): boolean {
	const { profile, configuredThinkingMode } = input;
	if (profile.defaultRequestThinkingMode !== "disabled") {
		return true;
	}
	return configuredThinkingMode === "enabled" && profile.canEnableThinking;
}

export function shouldRequireThinkingReplayByProfile(input: {
	readonly profile: ReasoningDialectProfile;
	readonly configuredThinkingMode?: InfiniAIModelConfiguration["thinkingMode"];
	readonly forceDisableThinking: boolean;
}): boolean {
	const { profile, configuredThinkingMode, forceDisableThinking } = input;
	if (
		forceDisableThinking ||
		configuredThinkingMode === "disabled" ||
		profile.replayRisk === "none" ||
		profile.replayRisk === "unknown" ||
		profile.replayRisk === "reasoning-content-best-effort-after-tool-call"
	) {
		return false;
	}
	return configuredThinkingMode === "enabled" || profile.defaultThinking === "on" || profile.defaultThinking === "forced";
}
