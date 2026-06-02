import type { OpenAIChatMessage, ProviderReasoningDetail } from "./openai/openaiTypes";
import type { ReasoningDialectProfile, ReplayCarrier } from "./reasoningDialect";
import type {
	AnthropicContentBlock,
	AnthropicMessage,
	AnthropicRedactedThinkingBlock,
	AnthropicThinkingBlock,
	AnthropicToolUseBlock,
} from "./anthropic/anthropicTypes";
import type { StoredReplayCarrier, ThinkingReplayEntry, ThinkingReplayStore } from "./thinkingReplayStore";
import { isStoredReplayCarrier } from "./thinkingReplayStore";

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

export interface ThinkingReplayFailureContext {
	readonly modelId?: string;
	readonly transport?: string;
	readonly profileId?: string;
	readonly carrier?: string;
}

export const THINKING_REPLAY_MISS_ERROR =
	"Reasoning cannot be resumed for this conversation because prior tool-call reasoning context is not available. " +
	"This can happen after cache expiry, clearing the replay cache, switching models, switching storage scopes, " +
	"or enabling reasoning mid-chat. Start a new chat to use reasoning with this model, or remove the reasoning " +
	"opt-in to continue this chat without thinking.";

function formatShortList(values: readonly string[], maxItems = 5): string {
	if (values.length <= maxItems) {
		return values.join(",");
	}
	return `${values.slice(0, maxItems).join(",")},+${values.length - maxItems} more`;
}

export function buildThinkingReplayMissError(
	preflight: ThinkingReplayPreflight<unknown>,
	context: ThinkingReplayFailureContext = {}
): string {
	const details: string[] = [];
	if (context.modelId) {
		details.push(`model=${context.modelId}`);
	}
	if (context.transport) {
		details.push(`transport=${context.transport}`);
	}
	if (context.profileId) {
		details.push(`profile=${context.profileId}`);
	}
	if (context.carrier) {
		details.push(`carrier=${context.carrier}`);
	}
	if (preflight.missingCallIds.length > 0) {
		details.push(`missingToolCallIds=${formatShortList(preflight.missingCallIds)}`);
	}
	if (preflight.conflictingCallIds.length > 0) {
		details.push(`conflictingToolCallIds=${formatShortList(preflight.conflictingCallIds)}`);
	}

	return details.length > 0
		? `${THINKING_REPLAY_MISS_ERROR} Details: ${details.join("; ")}.`
		: THINKING_REPLAY_MISS_ERROR;
}

function resolveReplayCarrier(profile: ReasoningDialectProfile | undefined): StoredReplayCarrier {
	const carrier = profile?.replayCarrier ?? "reasoning_content";
	return isStoredReplayCarrier(carrier) ? carrier : "reasoning_content";
}

function lookupReplayEntry(input: {
	readonly modelId: string;
	readonly callId: string;
	readonly carrier: StoredReplayCarrier;
	readonly profile?: ReasoningDialectProfile;
	readonly store: ThinkingReplayStore;
}): ThinkingReplayEntry | undefined {
	if (!input.profile) {
		return input.store.lookup(input.modelId, input.callId);
	}
	return input.store.lookup({
		modelId: input.modelId,
		callId: input.callId,
		profileId: input.profile.id,
		carrier: input.carrier,
	});
}

function replayPayloadKey(entry: ThinkingReplayEntry, carrier: StoredReplayCarrier): string | undefined {
	if (carrier === "reasoning_details") {
		return entry.reasoningDetails ? JSON.stringify(entry.reasoningDetails) : undefined;
	}
	return entry.reasoningContent;
}

function messageHasReplayCarrier(message: OpenAIChatMessage, carrier: ReplayCarrier): boolean {
	if (carrier === "reasoning_details") {
		return Array.isArray(message.reasoning_details) && message.reasoning_details.length > 0;
	}
	if (carrier === "reasoning_content" || carrier === "think_tag_content") {
		return typeof message.reasoning_content === "string" && message.reasoning_content.length > 0;
	}
	return false;
}

export function applyThinkingReplay(input: {
	readonly modelId: string;
	readonly profile?: ReasoningDialectProfile;
	readonly messages: readonly OpenAIChatMessage[];
	readonly store: ThinkingReplayStore;
}): ThinkingReplayPreflight {
	const missingCallIds: string[] = [];
	const conflictingCallIds: string[] = [];
	let hasAssistantToolCalls = false;
	let replayedCount = 0;
	const carrier = resolveReplayCarrier(input.profile);

	const messages = input.messages.map((message) => {
		if (message.role !== "assistant" || !message.tool_calls || message.tool_calls.length === 0) {
			return { ...message };
		}

		hasAssistantToolCalls = true;
		if (messageHasReplayCarrier(message, carrier)) {
			return { ...message };
		}

		const replayByCallId: Array<{ callId: string; entry: ThinkingReplayEntry; payloadKey: string }> = [];
		for (const toolCall of message.tool_calls) {
			if (!toolCall.id) {
				missingCallIds.push("<missing>");
				continue;
			}
			const entry = lookupReplayEntry({
				modelId: input.modelId,
				callId: toolCall.id,
				carrier,
				profile: input.profile,
				store: input.store,
			});
			const payloadKey = entry ? replayPayloadKey(entry, carrier) : undefined;
			if (!entry || !payloadKey) {
				missingCallIds.push(toolCall.id);
				continue;
			}
			replayByCallId.push({ callId: toolCall.id, entry, payloadKey });
		}

		if (replayByCallId.length !== message.tool_calls.length) {
			return { ...message };
		}

		const first = replayByCallId[0];
		if (!first) {
			return { ...message };
		}
		if (replayByCallId.some((entry) => entry.payloadKey !== first.payloadKey)) {
			conflictingCallIds.push(...replayByCallId.map((entry) => entry.callId));
			return { ...message };
		}

		replayedCount++;
		if (carrier === "reasoning_details") {
			return {
				...message,
				reasoning_details: [...(first.entry.reasoningDetails ?? [])] as ProviderReasoningDetail[],
			};
		}
		return { ...message, reasoning_content: first.entry.reasoningContent };
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

function isAnthropicRedactedThinkingBlock(block: AnthropicContentBlock): block is AnthropicRedactedThinkingBlock {
	return block.type === "redacted_thinking" && typeof block.data === "string" && block.data.length > 0;
}

function isAnthropicReplayBlock(
	block: AnthropicContentBlock
): block is AnthropicThinkingBlock | AnthropicRedactedThinkingBlock {
	return isAnthropicThinkingBlock(block) || isAnthropicRedactedThinkingBlock(block);
}

export function applyAnthropicThinkingReplay(input: {
	readonly modelId: string;
	readonly profile?: ReasoningDialectProfile;
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
		if (clonedContent.some(isAnthropicReplayBlock)) {
			return clonedMessage;
		}

		const reasoningByCallId: Array<{
			callId: string;
			reasoningContent: string | undefined;
			reasoningSignature: string | undefined;
			redactedThinkingData: string | undefined;
			payloadKey: string;
		}> = [];
		for (const toolUse of toolUseBlocks) {
			if (!toolUse.id) {
				missingCallIds.push("<missing>");
				continue;
			}
			const entry = input.profile
				? input.store.lookup({
						modelId: input.modelId,
						callId: toolUse.id,
						profileId: input.profile.id,
						carrier: "anthropic_thinking_block",
					})
				: input.store.lookup(input.modelId, toolUse.id);
			if (!entry?.reasoningContent && !entry?.redactedThinkingData) {
				missingCallIds.push(toolUse.id);
				continue;
			}
			reasoningByCallId.push({
				callId: toolUse.id,
				reasoningContent: entry.reasoningContent,
				reasoningSignature: entry.reasoningSignature,
				redactedThinkingData: entry.redactedThinkingData,
				payloadKey: entry.reasoningContent
					? JSON.stringify(["thinking", entry.reasoningContent, entry.reasoningSignature ?? ""])
					: JSON.stringify(["redacted_thinking", entry.redactedThinkingData ?? ""]),
			});
		}

		if (reasoningByCallId.length !== toolUseBlocks.length) {
			return clonedMessage;
		}

		const first = reasoningByCallId[0];
		if (!first) {
			return clonedMessage;
		}
		if (reasoningByCallId.some((entry) => entry.payloadKey !== first.payloadKey)) {
			conflictingCallIds.push(...reasoningByCallId.map((entry) => entry.callId));
			return clonedMessage;
		}

		const thinkingBlock: AnthropicThinkingBlock | AnthropicRedactedThinkingBlock = first.reasoningContent
			? {
					type: "thinking",
					thinking: first.reasoningContent,
					...(first.reasoningSignature ? { signature: first.reasoningSignature } : {}),
				}
			: {
					type: "redacted_thinking",
					data: first.redactedThinkingData ?? "",
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
	readonly replayRequiredByProfile?: boolean;
	readonly allowMissingReplay?: boolean;
	readonly preflight: ThinkingReplayPreflight<unknown>;
	readonly failureContext?: ThinkingReplayFailureContext;
}): ThinkingReplayRequestDecision {
	const shouldRoundTrip = input.userOptedIntoRoundTrip || input.replayRequiredByProfile === true;
	if (!shouldRoundTrip) {
		return { allowThinkingRoundTrip: false, failLocalReason: undefined };
	}
	if (
		!input.allowMissingReplay &&
		!input.preflight.allRequiredReasoningReplayed &&
		input.preflight.hasAssistantToolCalls
	) {
		return {
			allowThinkingRoundTrip: false,
			failLocalReason: buildThinkingReplayMissError(input.preflight, input.failureContext),
		};
	}
	return { allowThinkingRoundTrip: true, failLocalReason: undefined };
}
