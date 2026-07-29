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
	if (profile.replayRisk === "none" || profile.replayRisk === "unknown") {
		return false;
	}
	if (configuredThinkingMode === "disabled" && profile.canDisableThinking) {
		return false;
	}
	if (profile.defaultRequestThinkingMode !== "disabled") {
		return true;
	}
	return configuredThinkingMode === "enabled" && profile.canEnableThinking;
}

export function shouldCaptureDisabledThinkingObservation(input: {
	readonly profile: ReasoningDialectProfile;
	readonly configuredThinkingMode?: InfiniAIModelConfiguration["thinkingMode"];
	readonly forceDisableThinking: boolean;
	readonly allowThinkingRoundTrip: boolean;
}): boolean {
	const { profile, configuredThinkingMode, forceDisableThinking, allowThinkingRoundTrip } = input;
	if (profile.replayScope !== "all-assistant-messages" || !profile.canDisableThinking) {
		return false;
	}
	return (
		configuredThinkingMode === "disabled" ||
		(forceDisableThinking && !allowThinkingRoundTrip)
	);
}

export function shouldRequireThinkingReplayByProfile(input: {
	readonly profile: ReasoningDialectProfile;
	readonly configuredThinkingMode?: InfiniAIModelConfiguration["thinkingMode"];
	readonly forceDisableThinking: boolean;
}): boolean {
	const { profile, configuredThinkingMode, forceDisableThinking } = input;
	const thinkingIsDisabled =
		forceDisableThinking || (configuredThinkingMode === "disabled" && profile.canDisableThinking);
	if (
		thinkingIsDisabled ||
		profile.replayRisk === "none" ||
		profile.replayRisk === "unknown" ||
		profile.replayRisk === "reasoning-content-best-effort-after-tool-call"
	) {
		return false;
	}
	if (profile.replayRequiredByDefault !== undefined) {
		return profile.replayRequiredByDefault;
	}
	return (
		(configuredThinkingMode === "enabled" && profile.canEnableThinking) ||
		profile.defaultThinking === "on" ||
		profile.defaultThinking === "forced"
	);
}
