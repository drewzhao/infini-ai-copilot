import * as vscode from "vscode";
import {
	CancellationToken,
	LanguageModelChatRequestMessage,
	ProvideLanguageModelChatResponseOptions,
	Progress,
} from "vscode";

import type { InfiniAIModelInfo } from "../types";

import type {
	OpenAIChatMessage,
	OpenAIToolCall,
	ChatMessageContent,
	ReasoningDetail,
	ReasoningSummaryDetail,
	ReasoningTextDetail,
} from "./openaiTypes";

import {
	isImageMimeType,
	createDataUrl,
	isToolResultPart,
	collectToolResultText,
	convertToolsToOpenAI,
	mapRole,
} from "../utils";

import { CommonApi } from "../commonApi";
import { readSseEvents } from "../sse";
import { StreamParseError, sanitizeForLog } from "../utils";

export class OpenaiApi extends CommonApi {
	constructor() {
		super();
	}

	/**
	 * Convert VS Code chat request messages into OpenAI-compatible message objects.
	 * @param messages The VS Code chat messages to convert.
	 * @param modelConfig model configuration that may affect message conversion.
	 * @returns OpenAI-compatible messages array.
	 */
	convertMessages(
		messages: readonly LanguageModelChatRequestMessage[],
		_modelConfig: { includeReasoningInRequest: boolean }
	): OpenAIChatMessage[] {
		const out: OpenAIChatMessage[] = [];
		for (const m of messages) {
			const role = mapRole(m);
			const textParts: string[] = [];
			const imageParts: vscode.LanguageModelDataPart[] = [];
			const toolCalls: OpenAIToolCall[] = [];
			const toolResults: { callId: string; content: string }[] = [];

			for (const part of m.content ?? []) {
				if (part instanceof vscode.LanguageModelTextPart) {
					textParts.push(part.value);
				} else if (part instanceof vscode.LanguageModelDataPart && isImageMimeType(part.mimeType)) {
					imageParts.push(part);
				} else if (part instanceof vscode.LanguageModelToolCallPart) {
					const id = part.callId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
					let args = "{}";
					try {
						args = JSON.stringify(part.input ?? {});
					} catch {
						args = "{}";
					}
					toolCalls.push({ id, type: "function", function: { name: part.name, arguments: args } });
				} else if (isToolResultPart(part)) {
					const callId = (part as { callId?: string }).callId ?? "";
					const content = collectToolResultText(part as { content?: ReadonlyArray<unknown> });
					toolResults.push({ callId, content });
				}
			}

			// 构建 assistant 消息，包含思考内容
			if (role === "assistant") {
				const assistantMessage: OpenAIChatMessage = {
					role: "assistant",
					content: textParts.join("\n") || undefined,
				};

				// Add tool calls
				if (toolCalls.length > 0) {
					assistantMessage.tool_calls = toolCalls;
				}

				// Only include assistant messages that contain text or tool calls
				if (assistantMessage.content || assistantMessage.tool_calls) {
					out.push(assistantMessage);
				}
			}

			// 处理工具结果
			for (const tr of toolResults) {
				out.push({ role: "tool", tool_call_id: tr.callId, content: tr.content || "" });
			}

			// 处理用户和系统消息
			if (textParts.length > 0 && role !== "assistant") {
				if (role === "user") {
					if (imageParts.length > 0) {
						const contentArray: ChatMessageContent[] = [];
						contentArray.push({
							type: "text",
							text: textParts.join("\n"),
						});

						// 添加图片内容
						for (const imagePart of imageParts) {
							const dataUrl = createDataUrl(imagePart);
							contentArray.push({
								type: "image_url",
								image_url: {
									url: dataUrl,
								},
							});
						}
						out.push({ role, content: contentArray });
					} else {
						// 纯文本消息
						out.push({ role, content: textParts.join("\n") });
					}
				} else if (role === "system") {
					out.push({ role, content: textParts.join("\n") });
				}
			}
		}

		// 为支持缓存的消息添加缓存控制
		// 缓存策略：标记 system 消息和长文本消息用于缓存。最多支持 4 个缓存点。

		// 1. 识别所有潜在的缓存候选消息
		const cacheCandidates: number[] = [];
		for (let i = 0; i < out.length; i++) {
			const msg = out[i];

			// 策略1：System 消息
			const isSystem = msg.role === "system";

			// 策略2：前几条用户消息（上下文）
			const isEarlyUser = msg.role === "user" && i < 3;

			// 策略3：长文本
			let textLen = 0;
			if (typeof msg.content === "string") {
				textLen = msg.content.length;
			} else if (Array.isArray(msg.content)) {
				textLen = msg.content
					.filter((c: any) => c.type === "text")
					.reduce((acc: number, c: any) => acc + (c.text?.length || 0), 0);
			}
			const isLong = textLen > 1000;

			if (isSystem || isEarlyUser || isLong) {
				cacheCandidates.push(i);
			}
		}

		// 2. 确定可用配额并选择缓存点
		const maxMessagesWithCache = 4;
		// 优先保留最后的缓存点以最大化前缀复用
		const indicesToCache = new Set(cacheCandidates.slice(-maxMessagesWithCache));

		const messagesWithCache = out.map((v, index) => {
			const message = { ...v };

			if (indicesToCache.has(index)) {
				// Anthropic 格式的缓存控制
				message.cache_control = { type: "ephemeral" };
			}

			return message;
		});

		return messagesWithCache;
	}

	prepareRequestBody(
		rb: any,
		um: InfiniAIModelInfo | undefined,
		options: ProvideLanguageModelChatResponseOptions
	): any {
		const orb = rb as Record<string, unknown>;
		// // temperature
		// const oTemperature = options.modelOptions?.temperature ?? 0;
		// const temperature = um?.temperature ?? oTemperature;
		// orb.temperature = temperature;
		// if (um && um.temperature === null) {
		// 	delete orb.temperature;
		// }

		// // top_p
		// if (um?.top_p !== undefined && um.top_p !== null) {
		// 	orb.top_p = um.top_p;
		// }

		// // max_tokens
		// if (um?.max_tokens !== undefined) {
		// 	orb.max_tokens = um.max_tokens;
		// }

		// // max_completion_tokens (OpenAI new standard parameter)
		// if (um?.max_completion_tokens !== undefined) {
		// 	orb.max_completion_tokens = um.max_completion_tokens;
		// }

		// // OpenAI reasoning configuration
		// if (um?.reasoning_effort !== undefined) {
		// 	orb.reasoning_effort = um.reasoning_effort;
		// }

		// // enable_thinking (non-OpenRouter only)
		// const enableThinking = um?.enable_thinking;
		// if (enableThinking !== undefined) {
		// 	orb.enable_thinking = enableThinking;

		// 	if (um?.thinking_budget !== undefined) {
		// 		orb.thinking_budget = um.thinking_budget;
		// 	}
		// }

		// // thinking (Zai provider)
		// if (um?.thinking?.type !== undefined) {
		// 	orb.thinking = {
		// 		type: um.thinking.type,
		// 	};
		// }

		// OpenRouter reasoning configuration
		// if (um?.reasoning !== undefined) {
		// 	const reasoningConfig: ReasoningConfig = um.reasoning as ReasoningConfig;
		// 	if (reasoningConfig.enabled !== false) {
		// 		const reasoningObj: Record<string, unknown> = {};
		// 		const effort = reasoningConfig.effort;
		// 		const maxTokensReasoning = reasoningConfig.max_tokens || 2000; // Default 2000 as per docs
		// 		if (effort && effort !== "auto") {
		// 			reasoningObj.effort = effort;
		// 		} else {
		// 			// If auto or unspecified, use max_tokens (Anthropic-style fallback)
		// 			reasoningObj.max_tokens = maxTokensReasoning;
		// 		}
		// 		if (reasoningConfig.exclude !== undefined) {
		// 			reasoningObj.exclude = reasoningConfig.exclude;
		// 		}
		// 		orb.reasoning = reasoningObj;
		// 	}
		// }

		// stop
		if (options.modelOptions) {
			const mo = options.modelOptions as Record<string, unknown>;
			if (typeof mo.stop === "string" || Array.isArray(mo.stop)) {
				orb.stop = mo.stop;
			}
		}

		// tools
		const toolConfig = convertToolsToOpenAI(options);
		if (toolConfig.tools) {
			orb.tools = toolConfig.tools;
		}
		if (toolConfig.tool_choice) {
			orb.tool_choice = toolConfig.tool_choice;
		}

		// // Configure user-defined additional parameters
		// if (um?.top_k !== undefined) {
		// 	orb.top_k = um.top_k;
		// }
		// if (um?.min_p !== undefined) {
		// 	orb.min_p = um.min_p;
		// }
		// if (um?.frequency_penalty !== undefined) {
		// 	orb.frequency_penalty = um.frequency_penalty;
		// }
		// if (um?.presence_penalty !== undefined) {
		// 	orb.presence_penalty = um.presence_penalty;
		// }
		// if (um?.repetition_penalty !== undefined) {
		// 	orb.repetition_penalty = um.repetition_penalty;
		// }

		// Process extra configuration parameters
		// if (um?.extra && typeof um.extra === "object") {
		// 	// Add all extra parameters directly to the request body
		// 	for (const [key, value] of Object.entries(um.extra)) {
		// 		if (value !== undefined) {
		// 			orb[key] = value;
		// 		}
		// 	}
		// }

		return orb;
	}

	/**
	 * Read and parse the HF Router streaming (SSE-like) response and report parts.
	 * @param responseBody The readable stream body.
	 * @param progress Progress reporter for streamed parts.
	 * @param token Cancellation token.
	 */
	async processStreamingResponse(
		responseBody: ReadableStream<Uint8Array>,
		progress: Progress<vscode.LanguageModelResponsePart>,
		token: CancellationToken
	): Promise<void> {
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
					const parsed = JSON.parse(data);
					this.captureUsage(parsed);
					await this.processDelta(parsed, progress);
				} catch (err) {
					throw new StreamParseError(
						`OpenAI stream parse failed: ${sanitizeForLog(err instanceof Error ? err.message : String(err))}`
					);
				}
			}
		} finally {
			await this.flushToolCallBuffers(progress, /*throwOnInvalid*/ false);
			// If there's an active thinking sequence, end it first
			this.reportEndThinking();
		}
	}

	/** Extract OpenAI-style usage from a streamed chunk if present. */
	private captureUsage(parsed: Record<string, unknown>): void {
		const usage = parsed.usage as Record<string, unknown> | undefined;
		if (!usage) {
			return;
		}
		const input = Number(usage.prompt_tokens ?? 0);
		const output = Number(usage.completion_tokens ?? 0);
		const details = usage.prompt_tokens_details as Record<string, unknown> | undefined;
		const cached = details?.cached_tokens !== undefined ? Number(details.cached_tokens) : undefined;
		if (Number.isFinite(input) || Number.isFinite(output)) {
			this.lastUsage = {
				inputTokens: Number.isFinite(input) ? input : 0,
				outputTokens: Number.isFinite(output) ? output : 0,
				cachedTokens: cached !== undefined && Number.isFinite(cached) ? cached : undefined,
			};
		}
	}

	/**
	 * Handle a single streamed delta chunk, emitting text and tool call parts.
	 * @param delta Parsed SSE chunk from the Router.
	 * @param progress Progress reporter for parts.
	 */
	private async processDelta(
		delta: Record<string, unknown>,
		progress: Progress<vscode.LanguageModelResponsePart>
	): Promise<boolean> {
		let emitted = false;
		const choice = (delta.choices as Record<string, unknown>[] | undefined)?.[0];
		if (!choice) {
			return false;
		}

		const deltaObj = choice.delta as Record<string, unknown> | undefined;

		// Process thinking content first (before regular text content)
		try {
			let maybeThinking =
				(choice as Record<string, unknown> | undefined)?.thinking ??
				(deltaObj as Record<string, unknown> | undefined)?.thinking ??
				(deltaObj as Record<string, unknown> | undefined)?.reasoning_content;

			// OpenRouter/Claude reasoning_details array handling (new)
			const maybeReasoningDetails =
				(deltaObj as Record<string, unknown>)?.reasoning_details ??
				(choice as Record<string, unknown>)?.reasoning_details;
			if (maybeReasoningDetails && Array.isArray(maybeReasoningDetails) && maybeReasoningDetails.length > 0) {
				// Prioritize details array over simple reasoning
				const details: Array<ReasoningDetail> = maybeReasoningDetails as Array<ReasoningDetail>;
				// Sort by index to preserve order (in case out-of-order chunks)
				const sortedDetails = details.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

				for (const detail of sortedDetails) {
					let extractedText = "";
					if (detail.type === "reasoning.summary") {
						extractedText = (detail as ReasoningSummaryDetail).summary;
					} else if (detail.type === "reasoning.text") {
						extractedText = (detail as ReasoningTextDetail).text;
					} else if (detail.type === "reasoning.encrypted") {
						extractedText = "[REDACTED]"; // As per docs
					} else {
						extractedText = JSON.stringify(detail); // Fallback for unknown
					}

					if (extractedText) {
						this.bufferThinkingContent(extractedText);
						emitted = true;
					}
				}
				maybeThinking = null; // Skip simple thinking if details present
			}

			// Fallback to simple thinking if no details
			if (maybeThinking !== undefined && maybeThinking !== null) {
				let text = "";
				// let metadata: Record<string, unknown> | undefined;
				if (maybeThinking && typeof maybeThinking === "object") {
					const mt = maybeThinking as Record<string, unknown>;
					text = typeof mt["text"] === "string" ? (mt["text"] as string) : JSON.stringify(mt);
					// metadata = mt["metadata"] ? (mt["metadata"] as Record<string, unknown>) : undefined;
				} else if (typeof maybeThinking === "string") {
					text = maybeThinking;
				}
				if (text) {
					this.bufferThinkingContent(text);
					emitted = true;
				}
			}
		} catch {
			// Reasoning metadata is optional and provider-specific; ignore malformed detail chunks.
		}

		if (deltaObj?.content) {
			const content = String(deltaObj.content);

			// Process XML think blocks or text content (mutually exclusive)
			const xmlRes = this.processXmlThinkBlocks(content);
			if (!xmlRes.hasThinkContent) {
				// If there's an active thinking sequence, end it first
				this.reportEndThinking();

				// Only process text content if no XML think blocks were consumed
				const res = this.processTextContent(content, progress);
				if (res.emittedText) {
					this._hasEmittedAssistantText = true;
				}
				if (res.emittedAny) {
					emitted = true;
				}
			}
		}

		if (deltaObj?.tool_calls) {
			// If there's an active thinking sequence, end it first
			this.reportEndThinking();

			const toolCalls = deltaObj.tool_calls as Array<Record<string, unknown>>;

			// SSEProcessor-like: if first tool call appears after text, emit a whitespace
			// to ensure any UI buffers/linkifiers are flushed without adding visible noise.
			if (!this._emittedBeginToolCallsHint && this._hasEmittedAssistantText && toolCalls.length > 0) {
				progress.report(new vscode.LanguageModelTextPart(" "));
				this._emittedBeginToolCallsHint = true;
			}

			for (const tc of toolCalls) {
				const idx = (tc.index as number) ?? 0;
				// Ignore any further deltas for an index we've already completed
				if (this._completedToolCallIndices.has(idx)) {
					continue;
				}
				const buf = this._toolCallBuffers.get(idx) ?? { args: "" };
				if (tc.id && typeof tc.id === "string") {
					buf.id = tc.id as string;
				}
				const func = tc.function as Record<string, unknown> | undefined;
				if (func?.name && typeof func.name === "string") {
					buf.name = func.name as string;
				}
				if (typeof func?.arguments === "string") {
					buf.args += func.arguments as string;
				}
				this._toolCallBuffers.set(idx, buf);

				// Emit immediately once arguments become valid JSON to avoid perceived hanging
				await this.tryEmitBufferedToolCall(idx, progress);
			}
		}

		const finish = (choice.finish_reason as string | undefined) ?? undefined;
		if (finish === "tool_calls" || finish === "stop") {
			// On both 'tool_calls' and 'stop', emit any buffered calls and throw on invalid JSON
			await this.flushToolCallBuffers(progress, /*throwOnInvalid*/ true);
		}
		return emitted;
	}

	/**
	 * Process streamed text content for inline tool-call control tokens and emit text/tool calls.
	 * Returns which parts were emitted for logging/flow control.
	 */
	private processTextContent(
		input: string,
		progress: Progress<vscode.LanguageModelResponsePart>
	): { emittedText: boolean; emittedAny: boolean } {
		let emittedText = false;
		let emittedAny = false;

		// Emit any visible text
		const textToEmit = input;
		if (textToEmit && textToEmit.length > 0) {
			progress.report(new vscode.LanguageModelTextPart(textToEmit));
			emittedText = true;
			emittedAny = true;
		}

		return { emittedText, emittedAny };
	}

	/**
	 * Process streamed text content for XML think blocks and emit thinking parts.
	 * Returns whether any thinking content was emitted.
	 */
	private processXmlThinkBlocks(input: string): { hasThinkContent: boolean } {
		// If we've already attempted detection and found no THINK_START, skip processing
		if (this._xmlThinkDetectionAttempted && !this._xmlThinkActive) {
			return { hasThinkContent: false };
		}

		const THINK_START = "<think>";
		const THINK_END = "</think>";

		let data = input;
		let hasThinkContent = false;

		while (data.length > 0) {
			if (!this._xmlThinkActive) {
				// Look for think start tag
				const startIdx = data.indexOf(THINK_START);
				if (startIdx === -1) {
					// No think start found, mark detection as attempted and skip future processing
					this._xmlThinkDetectionAttempted = true;
					data = "";
					break;
				}

				// Found think start tag
				this._xmlThinkActive = true;
				// Generate a new thinking ID for this XML think block
				this._currentThinkingId = this.generateThinkingId();

				// Skip the start tag and continue processing
				data = data.slice(startIdx + THINK_START.length);
				continue;
			}

			// We are inside a think block, look for end tag
			const endIdx = data.indexOf(THINK_END);
			if (endIdx === -1) {
				// No end tag found, emit current chunk content as thinking part
				const thinkContent = data.trim();
				if (thinkContent) {
					hasThinkContent = true;
				}
				data = "";
				break;
			}

			// Found end tag, emit final thinking part
			const thinkContent = data.slice(0, endIdx);
			if (thinkContent) {
				hasThinkContent = true;
			}

			// Reset state and continue with remaining data
			this._xmlThinkActive = false;
			this._currentThinkingId = null;
			data = data.slice(endIdx + THINK_END.length);
		}

		return { hasThinkContent };
	}
}
