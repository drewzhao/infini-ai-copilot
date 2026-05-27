import type { InfiniAIModelConfiguration } from "./modelConfiguration";
import type { ReasoningDialectProfile } from "./reasoningDialect";

export interface ReasoningRequestControlOptions extends Pick<InfiniAIModelConfiguration, "thinkingMode"> {
	readonly preserveThinking?: boolean;
	readonly clearThinking?: boolean;
}

export interface ReasoningRequestControlResult {
	readonly currentTurnControlKind: ReasoningDialectProfile["currentTurnControl"]["kind"];
	readonly preservationControlKind: ReasoningDialectProfile["preservationControl"]["kind"];
	readonly ignoredControls: readonly string[];
	readonly writtenFields: readonly string[];
}

export function shouldApplyReplayPreservationControl(input: {
	readonly allowThinkingRoundTrip: boolean;
	readonly profile: ReasoningDialectProfile;
}): boolean {
	return input.allowThinkingRoundTrip && input.profile.preservationControl.kind !== "none";
}

export function buildReplayPreservationRequestControls(input: {
	readonly allowThinkingRoundTrip: boolean;
	readonly profile: ReasoningDialectProfile;
	readonly configuredThinkingMode?: InfiniAIModelConfiguration["thinkingMode"];
}): ReasoningRequestControlOptions | undefined {
	if (!shouldApplyReplayPreservationControl(input)) {
		return undefined;
	}
	return {
		thinkingMode:
			input.configuredThinkingMode === "disabled" || !input.profile.canEnableThinking ? undefined : "enabled",
		preserveThinking: true,
	};
}

function getThinkingObject(body: Record<string, unknown>): Record<string, unknown> {
	const existing = body.thinking;
	return typeof existing === "object" && existing !== null && !Array.isArray(existing)
		? { ...(existing as Record<string, unknown>) }
		: {};
}

function applyCurrentTurnControl(
	body: Record<string, unknown>,
	profile: ReasoningDialectProfile,
	thinkingMode: "enabled" | "disabled" | undefined,
	ignoredControls: string[],
	writtenFields: string[]
): void {
	if (!thinkingMode) {
		return;
	}
	if (thinkingMode === "disabled" && !profile.canDisableThinking) {
		ignoredControls.push("thinkingMode");
		return;
	}
	if (thinkingMode === "enabled" && !profile.canEnableThinking) {
		ignoredControls.push("thinkingMode");
		return;
	}

	switch (profile.currentTurnControl.kind) {
		case "qwen-enable-thinking":
			body.enable_thinking = thinkingMode === "enabled";
			delete body.thinking;
			writtenFields.push("enable_thinking");
			return;
		case "thinking-type":
			body.thinking = {
				...getThinkingObject(body),
				type: thinkingMode,
			};
			delete body.enable_thinking;
			writtenFields.push("thinking.type");
			return;
		case "anthropic-thinking":
			body.thinking = {
				...getThinkingObject(body),
				type: thinkingMode,
			};
			delete body.enable_thinking;
			writtenFields.push("thinking.type");
			return;
		case "none":
			ignoredControls.push("thinkingMode");
			return;
	}
}

function applyPreservationControl(
	body: Record<string, unknown>,
	profile: ReasoningDialectProfile,
	options: ReasoningRequestControlOptions,
	ignoredControls: string[],
	writtenFields: string[]
): void {
	if (options.preserveThinking === undefined && options.clearThinking === undefined) {
		return;
	}

	switch (profile.preservationControl.kind) {
		case "glm-clear-thinking": {
			const clearThinking = options.clearThinking ?? !options.preserveThinking;
			body.thinking = {
				...getThinkingObject(body),
				clear_thinking: clearThinking,
			};
			delete body.enable_thinking;
			writtenFields.push("thinking.clear_thinking");
			return;
		}
		case "kimi-keep":
			body.thinking = {
				...getThinkingObject(body),
				keep: options.preserveThinking ?? !options.clearThinking,
			};
			delete body.enable_thinking;
			writtenFields.push("thinking.keep");
			return;
		case "qwen-preserve-thinking":
			body.preserve_thinking = options.preserveThinking ?? !options.clearThinking;
			delete body.thinking;
			writtenFields.push("preserve_thinking");
			return;
		case "none":
			if (options.preserveThinking !== undefined) {
				ignoredControls.push("preserveThinking");
			}
			if (options.clearThinking !== undefined) {
				ignoredControls.push("clearThinking");
			}
			return;
	}
}

function applyReplayModeSelection(body: Record<string, unknown>, profile: ReasoningDialectProfile, writtenFields: string[]): void {
	if (profile.family === "minimax") {
		body.reasoning_split = true;
		writtenFields.push("reasoning_split");
	}
}

export function applyReasoningRequestControls(
	body: Record<string, unknown>,
	profile: ReasoningDialectProfile,
	options: ReasoningRequestControlOptions
): ReasoningRequestControlResult {
	const ignoredControls: string[] = [];
	const writtenFields: string[] = [];

	applyReplayModeSelection(body, profile, writtenFields);
	applyCurrentTurnControl(body, profile, options.thinkingMode, ignoredControls, writtenFields);
	applyPreservationControl(body, profile, options, ignoredControls, writtenFields);

	return {
		currentTurnControlKind: profile.currentTurnControl.kind,
		preservationControlKind: profile.preservationControl.kind,
		ignoredControls,
		writtenFields,
	};
}
