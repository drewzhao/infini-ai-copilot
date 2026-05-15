import type { OpenAIChatMessage } from "./openai/openaiTypes";
import type { ThinkingReplayStore } from "./thinkingReplayStore";

export interface ThinkingReplayPreflight {
	readonly messages: OpenAIChatMessage[];
	readonly allRequiredReasoningReplayed: boolean;
	readonly hasAssistantToolCalls: boolean;
	readonly replayedCount: number;
	readonly missingCallIds: readonly string[];
	readonly conflictingCallIds: readonly string[];
}

export interface ThinkingReplayRequestDecision {
	readonly allowThinkingRoundTrip: boolean;
	readonly failLocalReason: string | undefined;
}

export const THINKING_REPLAY_MISS_ERROR =
	"Reasoning cannot be resumed for this conversation because prior tool-call reasoning context is not available. " +
	"This can happen after cache expiry, clearing the replay cache, switching models, switching storage scopes, " +
	"or enabling reasoning mid-chat. Start a new chat to use reasoning with this model, or remove the reasoning " +
	"opt-in to continue this chat without thinking.";

export function applyThinkingReplay(input: {
	readonly modelId: string;
	readonly messages: readonly OpenAIChatMessage[];
	readonly store: ThinkingReplayStore;
}): ThinkingReplayPreflight {
	const missingCallIds: string[] = [];
	const conflictingCallIds: string[] = [];
	let hasAssistantToolCalls = false;
	let replayedCount = 0;

	const messages = input.messages.map((message) => {
		if (message.role !== "assistant" || !message.tool_calls || message.tool_calls.length === 0) {
			return { ...message };
		}

		hasAssistantToolCalls = true;
		if (message.reasoning_content) {
			return { ...message };
		}

		const reasoningByCallId: Array<{ callId: string; reasoningContent: string }> = [];
		for (const toolCall of message.tool_calls) {
			if (!toolCall.id) {
				missingCallIds.push("<missing>");
				continue;
			}
			const entry = input.store.lookup(input.modelId, toolCall.id);
			if (!entry) {
				missingCallIds.push(toolCall.id);
				continue;
			}
			reasoningByCallId.push({ callId: toolCall.id, reasoningContent: entry.reasoningContent });
		}

		if (reasoningByCallId.length !== message.tool_calls.length) {
			return { ...message };
		}

		const first = reasoningByCallId[0]?.reasoningContent;
		if (first === undefined) {
			return { ...message };
		}
		if (reasoningByCallId.some((entry) => entry.reasoningContent !== first)) {
			conflictingCallIds.push(...reasoningByCallId.map((entry) => entry.callId));
			return { ...message };
		}

		replayedCount++;
		return { ...message, reasoning_content: first };
	});

	return {
		messages,
		allRequiredReasoningReplayed: missingCallIds.length === 0 && conflictingCallIds.length === 0,
		hasAssistantToolCalls,
		replayedCount,
		missingCallIds,
		conflictingCallIds,
	};
}

export function decideThinkingReplayRequest(input: {
	readonly userOptedIntoRoundTrip: boolean;
	readonly preflight: ThinkingReplayPreflight;
}): ThinkingReplayRequestDecision {
	if (!input.userOptedIntoRoundTrip) {
		return { allowThinkingRoundTrip: false, failLocalReason: undefined };
	}
	if (!input.preflight.allRequiredReasoningReplayed && input.preflight.hasAssistantToolCalls) {
		return { allowThinkingRoundTrip: false, failLocalReason: THINKING_REPLAY_MISS_ERROR };
	}
	return { allowThinkingRoundTrip: true, failLocalReason: undefined };
}
