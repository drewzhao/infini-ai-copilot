import type { OpenAIChatMessage } from "./openai/openaiTypes";
import type {
	AnthropicContentBlock,
	AnthropicMessage,
	AnthropicThinkingBlock,
	AnthropicToolUseBlock,
} from "./anthropic/anthropicTypes";
import type { ThinkingReplayStore } from "./thinkingReplayStore";

export interface ThinkingReplayPreflight<TMessage = OpenAIChatMessage> {
	readonly messages: TMessage[];
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

function cloneAnthropicBlock(block: AnthropicContentBlock): AnthropicContentBlock {
	if (block.type === "image") {
		return { ...block, source: { ...block.source } };
	}
	if (block.type === "tool_use") {
		return { ...block, input: { ...block.input } };
	}
	if (block.type === "tool_result" && Array.isArray(block.content)) {
		return { ...block, content: block.content.map((contentBlock) => ({ ...contentBlock })) };
	}
	return { ...block };
}

function isAnthropicToolUseBlock(block: AnthropicContentBlock): block is AnthropicToolUseBlock {
	return block.type === "tool_use";
}

function isAnthropicThinkingBlock(block: AnthropicContentBlock): block is AnthropicThinkingBlock {
	return block.type === "thinking" && typeof block.thinking === "string" && block.thinking.length > 0;
}

export function applyAnthropicThinkingReplay(input: {
	readonly modelId: string;
	readonly messages: readonly AnthropicMessage[];
	readonly store: ThinkingReplayStore;
}): ThinkingReplayPreflight<AnthropicMessage> {
	const missingCallIds: string[] = [];
	const conflictingCallIds: string[] = [];
	let hasAssistantToolCalls = false;
	let replayedCount = 0;

	const messages = input.messages.map((message) => {
		const clonedContent = Array.isArray(message.content) ? message.content.map(cloneAnthropicBlock) : message.content;
		const clonedMessage: AnthropicMessage = { ...message, content: clonedContent };

		if (message.role !== "assistant" || !Array.isArray(clonedContent)) {
			return clonedMessage;
		}

		const toolUseBlocks = clonedContent.filter(isAnthropicToolUseBlock);
		if (toolUseBlocks.length === 0) {
			return clonedMessage;
		}

		hasAssistantToolCalls = true;
		if (clonedContent.some(isAnthropicThinkingBlock)) {
			return clonedMessage;
		}

		const reasoningByCallId: Array<{
			callId: string;
			reasoningContent: string;
			reasoningSignature: string | undefined;
		}> = [];
		for (const toolUse of toolUseBlocks) {
			if (!toolUse.id) {
				missingCallIds.push("<missing>");
				continue;
			}
			const entry = input.store.lookup(input.modelId, toolUse.id);
			if (!entry) {
				missingCallIds.push(toolUse.id);
				continue;
			}
			reasoningByCallId.push({
				callId: toolUse.id,
				reasoningContent: entry.reasoningContent,
				reasoningSignature: entry.reasoningSignature,
			});
		}

		if (reasoningByCallId.length !== toolUseBlocks.length) {
			return clonedMessage;
		}

		const first = reasoningByCallId[0];
		if (!first) {
			return clonedMessage;
		}
		if (
			reasoningByCallId.some(
				(entry) =>
					entry.reasoningContent !== first.reasoningContent || entry.reasoningSignature !== first.reasoningSignature
			)
		) {
			conflictingCallIds.push(...reasoningByCallId.map((entry) => entry.callId));
			return clonedMessage;
		}

		const thinkingBlock: AnthropicThinkingBlock = {
			type: "thinking",
			thinking: first.reasoningContent,
			...(first.reasoningSignature ? { signature: first.reasoningSignature } : {}),
		};
		const firstToolUseIndex = clonedContent.findIndex(isAnthropicToolUseBlock);
		clonedContent.splice(firstToolUseIndex === -1 ? 0 : firstToolUseIndex, 0, thinkingBlock);
		replayedCount++;
		return clonedMessage;
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
	readonly preflight: ThinkingReplayPreflight<unknown>;
}): ThinkingReplayRequestDecision {
	if (!input.userOptedIntoRoundTrip) {
		return { allowThinkingRoundTrip: false, failLocalReason: undefined };
	}
	if (!input.preflight.allRequiredReasoningReplayed && input.preflight.hasAssistantToolCalls) {
		return { allowThinkingRoundTrip: false, failLocalReason: THINKING_REPLAY_MISS_ERROR };
	}
	return { allowThinkingRoundTrip: true, failLocalReason: undefined };
}
