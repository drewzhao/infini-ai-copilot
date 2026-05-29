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
import {
	applyOpenAIModelConfiguration,
	resolveInfiniAIModelConfiguration,
} from "../modelConfiguration";
import { resolveReasoningDialectProfile } from "../reasoningDialect";
import { applyReasoningRequestControls } from "../reasoningRequest";
import { readSseEvents } from "../sse";
import { StreamParseError, sanitizeForLog } from "../utils";
import {
	getDisableThinkingPatterns,
	getThinkingRoundTripPatterns,
	shouldEnableThinkingRoundTrip,
	shouldDisableThinking,
} from "../thinkingMode";
import { sanitizeKimiOpenAITools } from "../kimiToolSchema";
import { getThinkingPartCtor } from "../proposedApi";
import type { PendingThinkingTurn, StoredReplayCarrier, ThinkingReplayStore } from "../thinkingReplayStore";

export interface OpenaiApiOptions {
	readonly thinkingReplayStore?: ThinkingReplayStore;
	readonly pendingThinkingTurn?: PendingThinkingTurn;
	readonly emitThinkingParts?: boolean;
	readonly replayCarrier?: StoredReplayCarrier;
}

const HIDDEN_THINKING_NO_FINAL_TEXT_FALLBACK =
	"The model returned hidden reasoning but no final answer. Please retry with a direct final-answer instruction.";
const EMPTY_NO_FINAL_TEXT_FALLBACK = "The model finished without returning a final answer. Please retry.";

export class OpenaiApi extends CommonApi {
	private readonly thinkingReplayStore?: ThinkingReplayStore;
	private readonly pendingThinkingTurn?: PendingThinkingTurn;
	private readonly emitThinkingParts: boolean;
	private readonly replayCarrier: StoredReplayCarrier;
	private thinkingReplayTerminal = false;
	private sawHiddenThinkingContent = false;
	private hasEmittedVisibleText = false;

	constructor(options: OpenaiApiOptions = {}) {
		super();
		this.thinkingReplayStore = options.thinkingReplayStore;
		this.pendingThinkingTurn = options.pendingThinkingTurn;
		this.emitThinkingParts = options.emitThinkingParts ?? true;
		this.replayCarrier = options.replayCarrier ?? "reasoning_content";
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
		const ThinkingPartCtor = getThinkingPartCtor();
		for (const m of messages) {
			const role = mapRole(m);
			const textParts: string[] = [];
			const imageParts: vscode.LanguageModelDataPart[] = [];
			const toolCalls: OpenAIToolCall[] = [];
			const toolResults: { callId: string; content: string }[] = [];
			const thinkingTexts: string[] = [];

			for (const part of m.content ?? []) {
				if (part instanceof vscode.LanguageModelTextPart) {
					textParts.push(part.value);
				} else if (ThinkingPartCtor && part instanceof ThinkingPartCtor) {
					const v = (part as vscode.LanguageModelThinkingPart).value;
					thinkingTexts.push(Array.isArray(v) ? v.join("") : v);
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

				// Preserve host-supplied thinking parts if a dev/custom host provides
				// them. This is optional compatibility only; MiMo V2 / DeepSeek V4
				// replay correctness is enforced by the extension-owned replay store
				// before unsafe tool-call follow-up requests are sent.
				if (thinkingTexts.length > 0) {
					assistantMessage.reasoning_content = thinkingTexts.join("");
				}

				// Only include assistant messages that contain text, tool calls, or reasoning
				if (assistantMessage.content || assistantMessage.tool_calls || assistantMessage.reasoning_content) {
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
		options: ProvideLanguageModelChatResponseOptions,
		replayPreflightSafe = false
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

		const modelId = um?.id ?? (typeof orb.model === "string" ? orb.model : "");
		const reasoningProfile = resolveReasoningDialectProfile({ modelId, transport: "openai" });

		// tools
		const toolConfig = convertToolsToOpenAI(options);
		if (toolConfig.tools) {
			orb.tools =
				reasoningProfile.family === "kimi" || reasoningProfile.family === "mimo"
					? sanitizeKimiOpenAITools(toolConfig.tools)
					: toolConfig.tools;
		}
		if (toolConfig.tool_choice) {
			orb.tool_choice = toolConfig.tool_choice;
		}

		applyOpenAIModelConfiguration(orb, resolveInfiniAIModelConfiguration(options), reasoningProfile, {
			useDefaultReasoningEffort: replayPreflightSafe,
		});

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

		// Force-disable thinking mode for models whose `reasoning_content`
		// cannot yet be proven to round-trip through the active VS Code/Copilot
		// Chat request path (known Xiaomi MiMo V2 model IDs, DeepSeek V4 family,
		// plus user additions). Constructor availability alone is not a replay
		// guarantee, so the safety list wins on stable and Insiders unless a
		// future verified backend explicitly opts this request in.
		const forceDisableThinking = shouldDisableThinking(modelId, getDisableThinkingPatterns());
		const userOptedIntoRoundTrip = shouldEnableThinkingRoundTrip(modelId, getThinkingRoundTripPatterns());
		const allowThinkingRoundTrip = userOptedIntoRoundTrip && replayPreflightSafe;

		if (forceDisableThinking && !allowThinkingRoundTrip) {
			applyReasoningRequestControls(orb, reasoningProfile, { thinkingMode: "disabled" });
		}

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
					const parsed = JSON.parse(data);
					this.captureUsage(parsed);
					await this.processDelta(parsed, progress);
				} catch (err) {
					throw new StreamParseError(
						`OpenAI stream parse failed: ${sanitizeForLog(err instanceof Error ? err.message : String(err))}`
					);
				}
			}
			completed = true;
		} catch (err) {
			this.abortReplayTurn();
			throw err;
		} finally {
			await this.flushToolCallBuffers(progress, /*throwOnInvalid*/ false);
			this.flushXmlThinkPending(progress);
			if (completed) {
				await this.completeReplayTurn();
				this.reportNoVisibleResponseFallback(progress);
			} else {
				this.abortReplayTurn();
			}
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
						this.sawHiddenThinkingContent = true;
						if (this.replayCarrier === "reasoning_details") {
							this.captureReplayReasoningDetails([detail]);
						} else {
							this.captureReplayReasoning(extractedText);
						}
						this.bufferThinkingContent(extractedText, progress);
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
					this.sawHiddenThinkingContent = true;
					this.captureReplayReasoning(text);
					this.bufferThinkingContent(text, progress);
					emitted = true;
				}
			}
		} catch {
			// Reasoning metadata is optional and provider-specific; ignore malformed detail chunks.
		}

		if (deltaObj?.content) {
			const content = String(deltaObj.content);

			const xmlRes = this.processXmlThinkBlocks(content);
			if (xmlRes.sawThinkContent) {
				this.sawHiddenThinkingContent = true;
				emitted = true;
			}
			if (xmlRes.visibleText) {
				// If there's an active thinking sequence, end it first
				this.reportEndThinking();

				const res = this.processTextContent(xmlRes.visibleText, progress);
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
				await this.completeReplayTurn();
			}
			return emitted;
		}

	protected override onToolCallEmitted(callId: string): void {
		if (!this.thinkingReplayStore || !this.pendingThinkingTurn) {
			return;
		}
		this.thinkingReplayStore.recordToolCall(this.pendingThinkingTurn.turnId, callId);
	}

	protected override bufferThinkingContent(
		text: string,
		progress?: Progress<vscode.LanguageModelResponsePart>
	): void {
		super.bufferThinkingContent(text, this.emitThinkingParts ? progress : undefined);
	}

	private captureReplayReasoning(text: string): void {
		if (!this.thinkingReplayStore || !this.pendingThinkingTurn) {
			return;
		}
		this.thinkingReplayStore.appendReasoning(this.pendingThinkingTurn.turnId, text);
	}

	private captureReplayReasoningDetails(details: readonly unknown[]): void {
		if (!this.thinkingReplayStore || !this.pendingThinkingTurn) {
			return;
		}
		this.thinkingReplayStore.appendReasoningDetails(this.pendingThinkingTurn.turnId, details);
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
			if (textToEmit.trim().length > 0) {
				this.hasEmittedVisibleText = true;
			}
		}

		return { emittedText, emittedAny };
	}

	/**
	 * Strip XML think blocks from streamed text content and return text that is
	 * safe to show as the model's final answer. The parser keeps partial
	 * `<think>` / `</think>` tags across chunks so split tags are not leaked or
	 * mistaken for user-visible text.
	 */
	private processXmlThinkBlocks(input: string): { visibleText: string; sawThinkContent: boolean } {
		const THINK_START = "<think>";
		const THINK_END = "</think>";

		let data = this._xmlThinkPending + input;
		this._xmlThinkPending = "";
		let visibleText = "";
		let sawThinkContent = false;

		while (data.length > 0) {
			if (this._xmlThinkActive) {
				const endIdx = data.indexOf(THINK_END);
				if (endIdx === -1) {
					const pendingLength = this.partialTagSuffixLength(data, THINK_END);
					const hidden = pendingLength > 0 ? data.slice(0, -pendingLength) : data;
					if (hidden.trim()) {
						sawThinkContent = true;
					}
					this._xmlThinkPending = pendingLength > 0 ? data.slice(-pendingLength) : "";
					break;
				}

				const hidden = data.slice(0, endIdx);
				if (hidden.trim()) {
					sawThinkContent = true;
				}
				this._xmlThinkActive = false;
				this._currentThinkingId = null;
				data = data.slice(endIdx + THINK_END.length);
				continue;
			}

			const startIdx = data.indexOf(THINK_START);
			if (startIdx === -1) {
				const pendingLength = this.partialTagSuffixLength(data, THINK_START);
				if (pendingLength > 0) {
					visibleText += data.slice(0, -pendingLength);
					this._xmlThinkPending = data.slice(-pendingLength);
				} else {
					visibleText += data;
				}
				break;
			}

			visibleText += data.slice(0, startIdx);
			this._xmlThinkActive = true;
			this._currentThinkingId = this.generateThinkingId();
			sawThinkContent = true;
			data = data.slice(startIdx + THINK_START.length);
		}

		return { visibleText, sawThinkContent };
	}

	private partialTagSuffixLength(data: string, tag: string): number {
		const max = Math.min(data.length, tag.length - 1);
		for (let length = max; length > 0; length--) {
			if (data.endsWith(tag.slice(0, length))) {
				return length;
			}
		}
		return 0;
	}

	private flushXmlThinkPending(progress: Progress<vscode.LanguageModelResponsePart>): void {
		if (!this._xmlThinkPending) {
			return;
		}
		if (!this._xmlThinkActive) {
			const pending = this._xmlThinkPending;
			progress.report(new vscode.LanguageModelTextPart(pending));
			this._hasEmittedAssistantText = true;
			if (pending.trim()) {
				this.hasEmittedVisibleText = true;
			}
		}
		this._xmlThinkPending = "";
	}

	private reportNoVisibleResponseFallback(progress: Progress<vscode.LanguageModelResponsePart>): void {
		if (this.hasEmittedVisibleText || this._completedToolCallIndices.size > 0) {
			return;
		}
		const message = this.sawHiddenThinkingContent ? HIDDEN_THINKING_NO_FINAL_TEXT_FALLBACK : EMPTY_NO_FINAL_TEXT_FALLBACK;
		progress.report(new vscode.LanguageModelTextPart(message));
		this._hasEmittedAssistantText = true;
		this.hasEmittedVisibleText = true;
	}
}
