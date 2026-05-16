import * as vscode from "vscode";
import {
	CancellationToken,
	LanguageModelChatRequestMessage,
	ProvideLanguageModelChatResponseOptions,
	Progress,
} from "vscode";

import type { InfiniAIModelInfo } from "../types";

import type {
	AnthropicMessage,
	AnthropicRequestBody,
	AnthropicContentBlock,
	AnthropicToolUseBlock,
	AnthropicToolResultBlock,
	AnthropicStreamChunk,
} from "./anthropicTypes";

import { isImageMimeType, isToolResultPart, collectToolResultText, convertToolsToOpenAI, mapRole } from "../utils";

import { CommonApi } from "../commonApi";
import { applyAnthropicModelConfiguration, resolveInfiniAIModelConfiguration } from "../modelConfiguration";
import { getThinkingPartCtor } from "../proposedApi";
import { readSseEvents } from "../sse";
import { ProviderProtocolError, StreamParseError, sanitizeForLog } from "../utils";
import type { PendingThinkingTurn, ThinkingReplayStore } from "../thinkingReplayStore";

export interface AnthropicApiOptions {
	readonly thinkingReplayStore?: ThinkingReplayStore;
	readonly pendingThinkingTurn?: PendingThinkingTurn;
	readonly emitThinkingParts?: boolean;
}

export class AnthropicApi extends CommonApi {
	private _systemContent: string | undefined;
	private readonly thinkingReplayStore?: ThinkingReplayStore;
	private readonly pendingThinkingTurn?: PendingThinkingTurn;
	private readonly emitThinkingParts: boolean;
	private thinkingReplayTerminal = false;

	constructor(options: AnthropicApiOptions = {}) {
		super();
		this.thinkingReplayStore = options.thinkingReplayStore;
		this.pendingThinkingTurn = options.pendingThinkingTurn;
		this.emitThinkingParts = options.emitThinkingParts ?? true;
	}

	/**
	 * Convert VS Code chat messages to Anthropic message format.
	 * @param messages The VS Code chat messages to convert.
	 * @param modelConfig model configuration that may affect message conversion.
	 * @returns Anthropic-compatible messages array.
	 */
	convertMessages(
		messages: readonly LanguageModelChatRequestMessage[],
		modelConfig: { includeReasoningInRequest: boolean; supportParameters: string }
	): AnthropicMessage[] {
		const out: AnthropicMessage[] = [];
		const ThinkingPartCtor = getThinkingPartCtor();

		for (const m of messages) {
			const role = mapRole(m);
			const textParts: string[] = [];
			const imageParts: vscode.LanguageModelDataPart[] = [];
			const toolCalls: AnthropicToolUseBlock[] = [];
			const toolResults: AnthropicToolResultBlock[] = [];
			const thinkingParts: string[] = [];

			for (const part of m.content ?? []) {
				if (part instanceof vscode.LanguageModelTextPart) {
					if (part.value.trim().length === 0) {
						continue;
					}
					textParts.push(part.value);
				} else if (part instanceof vscode.LanguageModelDataPart && isImageMimeType(part.mimeType)) {
					imageParts.push(part);
				} else if (part instanceof vscode.LanguageModelToolCallPart) {
					const id = part.callId || `toolu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
					toolCalls.push({
						type: "tool_use",
						id,
						name: part.name,
						input: (part.input as Record<string, unknown>) ?? {},
					});
				} else if (isToolResultPart(part)) {
					const callId = (part as { callId?: string }).callId ?? "";
					const content = collectToolResultText(part as { content?: ReadonlyArray<unknown> });
					toolResults.push({
						type: "tool_result",
						tool_use_id: callId,
						content,
					});
				} else if (ThinkingPartCtor && part instanceof ThinkingPartCtor) {
					const value = (part as vscode.LanguageModelThinkingPart).value;
					thinkingParts.push(Array.isArray(value) ? value.join("") : value);
				}
			}

			// Handle system messages separately (Anthropic uses top-level system field)
			if (role === "system") {
				if (textParts.length > 0) {
					this._systemContent = textParts.join("\n");
				}
				continue;
			}

			// Build content blocks for user/assistant messages
			const contentBlocks: AnthropicContentBlock[] = [];

			// Add text content
			if (textParts.length > 0) {
				contentBlocks.push({
					type: "text",
					text: textParts.join("\n"),
				});
			}

			// Add image content
			for (const imagePart of imageParts) {
				const base64Data = Buffer.from(imagePart.data).toString("base64");
				contentBlocks.push({
					type: "image",
					source: {
						type: "base64",
						media_type: imagePart.mimeType,
						data: base64Data,
					},
				});
			}

			// Add thinking content for assistant messages
			if (role === "assistant" && thinkingParts.length > 0 && modelConfig.includeReasoningInRequest) {
				contentBlocks.push({
					type: "thinking",
					thinking: thinkingParts.join("\n"),
				});
			}

			// Add tool calls for assistant messages
			for (const toolCall of toolCalls) {
				contentBlocks.push(toolCall);
			}

			// For tool results, they should be added to user messages
			// We'll add them to the current message if it's a user message
			if (role === "user" && toolResults.length > 0) {
				for (const toolResult of toolResults) {
					contentBlocks.push(toolResult);
				}
			} else if (toolResults.length > 0) {
				// Tool results in non-user messages are ignored by Anthropic.
			}

			// Only add message if we have content blocks
			if (contentBlocks.length > 0) {
				out.push({
					role,
					content: contentBlocks,
				});
			}
		}

		// 为关键消息添加缓存控制
		// Anthropic 的缓存策略：在长上下文的末尾标记缓存点。最多支持 4 个缓存点。

		// 1. 识别所有潜在的缓存候选消息
		const cacheCandidates: number[] = [];
		for (let i = 0; i < out.length; i++) {
			const msg = out[i];
			if (!Array.isArray(msg.content) || msg.content.length === 0) {
				continue;
			}

			// 策略1：缓存前几条用户消息（通常包含重要上下文）
			const shouldCacheEarlyUserMessage = msg.role === "user" && i < 2;

			// 策略2：缓存包含大量文本内容的消息（如代码上下文）
			const totalTextLength = msg.content
				.filter((block) => block.type === "text")
				.reduce((sum, block) => sum + ((block as any).text?.length || 0), 0);
			const shouldCacheLongContent = totalTextLength > 1024;

			if (shouldCacheEarlyUserMessage || shouldCacheLongContent) {
				cacheCandidates.push(i);
			}
		}

		// 2. 确定可用配额并选择缓存点
		// System 消息如果在 prepareRequestBody 中被使用了，会占用 1 个配额
		const systemTakesCache = !!this._systemContent;
		const maxMessagesWithCache = systemTakesCache ? 3 : 4;

		// 优先保留最后的缓存点以最大化前缀复用
		const indicesToCache = new Set(cacheCandidates.slice(-maxMessagesWithCache));

		// 3. 应用缓存控制
		const messagesWithCache = out.map((msg, index) => {
			if (indicesToCache.has(index) && Array.isArray(msg.content) && msg.content.length > 0) {
				const contentBlocks = [...msg.content];
				// 尝试在最后一个支持缓存的 block 上添加标记
				// 注意：Thinking block 目前可能不支持，所以要找到最后一个支持的类型
				let targetBlockIndex = -1;
				for (let i = contentBlocks.length - 1; i >= 0; i--) {
					const block = contentBlocks[i];
					if (
						block.type === "text" ||
						block.type === "image" ||
						block.type === "tool_use" ||
						block.type === "tool_result"
					) {
						targetBlockIndex = i;
						break;
					}
				}

				if (targetBlockIndex !== -1) {
					const targetBlock = contentBlocks[targetBlockIndex];
					(targetBlock as any).cache_control = { type: "ephemeral" };
				}

				return { ...msg, content: contentBlocks };
			}
			return msg;
		});

		return messagesWithCache;
	}

	prepareRequestBody(
		rb: any,
		um: InfiniAIModelInfo | undefined,
		options: ProvideLanguageModelChatResponseOptions
	): any {
		const arb = rb as AnthropicRequestBody;
		// Set max_tokens (required for Anthropic)
		// if (um?.max_tokens !== undefined) {
		// 	arb.max_tokens = um.max_tokens;
		// }

		// Add system content if we extracted it with cache control
		if (this._systemContent) {
			// 使用结构化 system 格式以支持缓存
			arb.system = [
				{
					type: "text",
					text: this._systemContent,
					cache_control: { type: "ephemeral" }, // System 消息总是缓存
				},
			];
		}

		// Add temperature
		// const oTemperature = options.modelOptions?.temperature ?? 0;
		// const temperature = um?.temperature ?? oTemperature;
		// arb.temperature = temperature;
		// if (um && um.temperature === null) {
		// 	delete arb.temperature;
		// }

		// // Add top_p if configured
		// if (um?.top_p !== undefined && um.top_p !== null) {
		// 	arb.top_p = um.top_p;
		// }

		// // Add top_k if configured
		// if (um?.top_k !== undefined) {
		// 	arb.top_k = um.top_k;
		// }

		// Add tools configuration
		const toolConfig = convertToolsToOpenAI(options);
		if (toolConfig.tools) {
			// Convert OpenAI tool definitions to Anthropic format
			arb.tools = toolConfig.tools.map((tool) => ({
				name: tool.function.name,
				description: tool.function.description,
				input_schema: tool.function.parameters,
			}));
		}

		// Add tool_choice
		if (toolConfig.tool_choice) {
			if (toolConfig.tool_choice === "auto") {
				arb.tool_choice = { type: "auto" };
			} else if (typeof toolConfig.tool_choice === "object" && toolConfig.tool_choice.type === "function") {
				arb.tool_choice = { type: "tool", name: toolConfig.tool_choice.function.name };
			}
		}

		applyAnthropicModelConfiguration(arb, resolveInfiniAIModelConfiguration(options));

		// Process extra configuration parameters
		// if (um?.extra && typeof um.extra === "object") {
		// 	// Add all extra parameters directly to the request body
		// 	for (const [key, value] of Object.entries(um.extra)) {
		// 		if (value !== undefined) {
		// 			(arb as unknown as Record<string, unknown>)[key] = value;
		// 		}
		// 	}
		// }

		return arb;
	}

	/**
	 * Process Anthropic streaming response (SSE format).
	 * @param responseBody The readable stream body.
	 * @param progress Progress reporter for streamed parts.
	 * @param token Cancellation token.
	 */
	async processStreamingResponse(
		responseBody: ReadableStream<Uint8Array>,
		progress: Progress<vscode.LanguageModelResponsePart>,
		token: CancellationToken
	): Promise<void> {
		let completed = false;
		try {
			for await (const event of readSseEvents(responseBody, token)) {
				const data = event.data.trim();
				if (!data) {
					continue;
				}
				if (data === "[DONE]") {
					await this.flushToolCallBuffers(progress, /*throwOnInvalid*/ false);
					continue;
				}
				try {
					const chunk: AnthropicStreamChunk = JSON.parse(data);
					await this.processAnthropicChunk(chunk, progress);
				} catch (err) {
					if (err instanceof ProviderProtocolError) {
						throw err;
					}
					throw new StreamParseError(
						`Anthropic stream parse failed: ${sanitizeForLog(err instanceof Error ? err.message : String(err))}`
					);
				}
			}
			completed = true;
		} catch (err) {
			this.abortReplayTurn();
			throw err;
		} finally {
			await this.flushToolCallBuffers(progress, /*throwOnInvalid*/ false);
			// If there's an active thinking sequence, end it first
			this.reportEndThinking();
			if (completed) {
				await this.completeReplayTurn();
			} else {
				this.abortReplayTurn();
			}
		}
	}

	/**
	 * Process a single Anthropic streaming chunk.
	 * @param chunk Parsed Anthropic stream chunk.
	 * @param progress Progress reporter for parts.
	 */
	private async processAnthropicChunk(
		chunk: AnthropicStreamChunk,
		progress: Progress<vscode.LanguageModelResponsePart>
	): Promise<void> {
		// Handle ping events (ignore)
		if (chunk.type === "ping") {
			return;
		}

		// Handle error events
		if (chunk.type === "error") {
			const errorType = chunk.error?.type || "unknown_error";
			const errorMessage = chunk.error?.message || "Anthropic API streaming error";
			throw new ProviderProtocolError(`Anthropic stream error: ${errorType} - ${errorMessage}`);
		}

		if (chunk.type === "message_start" && chunk.message) {
			if (chunk.usage) {
				this.lastUsage = {
					inputTokens: chunk.usage.input_tokens ?? 0,
					outputTokens: chunk.usage.output_tokens ?? 0,
				};
			}
			return;
		}

		if (chunk.type === "message_delta" && chunk.delta) {
			if (chunk.usage) {
				const prev = this.lastUsage;
				this.lastUsage = {
					inputTokens: chunk.usage.input_tokens ?? prev?.inputTokens ?? 0,
					outputTokens: chunk.usage.output_tokens ?? prev?.outputTokens ?? 0,
					cachedTokens: prev?.cachedTokens,
				};
			}
			return;
		}

		if (chunk.type === "content_block_start" && chunk.content_block) {
			// Start of a content block
			if (chunk.content_block.type === "thinking") {
				// Start thinking block
				if (chunk.content_block.thinking) {
					this.captureReplayReasoning(chunk.content_block.thinking);
					this.bufferThinkingContent(chunk.content_block.thinking, progress);
				}
			} else if (chunk.content_block.type === "tool_use") {
				// Start tool call block
				// SSEProcessor-like: if first tool call appears after text, emit a whitespace
				// to ensure any UI buffers/linkifiers are flushed without adding visible noise.
				if (!this._emittedBeginToolCallsHint && this._hasEmittedAssistantText) {
					progress.report(new vscode.LanguageModelTextPart(" "));
					this._emittedBeginToolCallsHint = true;
				}
				const idx = (chunk.index as number) ?? 0;
				this._toolCallBuffers.set(idx, {
					id: chunk.content_block.id,
					name: chunk.content_block.name,
					args: "",
				});
			} else if (chunk.content_block.type === "text") {
				// Text block start - nothing special to do
				// The text content will come via content_block_delta events
			}
		} else if (chunk.type === "content_block_delta" && chunk.delta) {
			if (chunk.delta.type === "text_delta" && chunk.delta.text) {
				// Emit text content
				progress.report(new vscode.LanguageModelTextPart(chunk.delta.text));
				this._hasEmittedAssistantText = true;
			} else if (chunk.delta.type === "thinking_delta" && chunk.delta.thinking) {
				// Buffer thinking content
				this.captureReplayReasoning(chunk.delta.thinking);
				this.bufferThinkingContent(chunk.delta.thinking, progress);
			} else if (chunk.delta.type === "input_json_delta" && chunk.delta.partial_json) {
				// Handle tool call argument streaming
				// Find the latest tool call buffer and append partial JSON
				const idx = (chunk.index as number) ?? 0;
				const buf = this._toolCallBuffers.get(idx);
				if (buf) {
					buf.args += chunk.delta.partial_json;
					this._toolCallBuffers.set(idx, buf);
					// Try to emit if we have valid JSON
					await this.tryEmitBufferedToolCall(idx, progress);
				}
			} else if (chunk.delta.type === "signature_delta" && chunk.delta.signature) {
				this.captureReplaySignature(chunk.delta.signature);
			}
		} else if (chunk.type === "content_block_stop" || chunk.type === "message_stop") {
			// End of message - ensure thinking is ended and flush all tool calls
			await this.flushToolCallBuffers(progress, false);
			this.reportEndThinking();
		}
	}

	protected override onToolCallEmitted(callId: string): void {
		if (!this.thinkingReplayStore || !this.pendingThinkingTurn) {
			return;
		}
		this.thinkingReplayStore.recordToolCall(this.pendingThinkingTurn.turnId, callId);
	}

	protected override bufferThinkingContent(text: string, progress?: Progress<vscode.LanguageModelResponsePart>): void {
		super.bufferThinkingContent(text, this.emitThinkingParts ? progress : undefined);
	}

	private captureReplayReasoning(text: string): void {
		if (!this.thinkingReplayStore || !this.pendingThinkingTurn) {
			return;
		}
		this.thinkingReplayStore.appendReasoning(this.pendingThinkingTurn.turnId, text);
	}

	private captureReplaySignature(signature: string): void {
		if (!this.thinkingReplayStore || !this.pendingThinkingTurn) {
			return;
		}
		this.thinkingReplayStore.appendReasoningSignature(this.pendingThinkingTurn.turnId, signature);
	}

	private async completeReplayTurn(): Promise<void> {
		if (this.thinkingReplayTerminal || !this.thinkingReplayStore || !this.pendingThinkingTurn) {
			return;
		}
		this.thinkingReplayTerminal = true;
		await this.thinkingReplayStore.commit(this.pendingThinkingTurn.turnId);
	}

	private abortReplayTurn(): void {
		if (this.thinkingReplayTerminal || !this.thinkingReplayStore || !this.pendingThinkingTurn) {
			return;
		}
		this.thinkingReplayTerminal = true;
		this.thinkingReplayStore.abort(this.pendingThinkingTurn.turnId);
	}
}
