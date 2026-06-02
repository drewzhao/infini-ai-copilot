import {
	ProvideLanguageModelChatResponseOptions,
	LanguageModelChatRequestMessage,
	LanguageModelToolCallPart,
	Progress,
	CancellationToken,
} from "vscode";
import * as vscode from "vscode";

import type { OpenAIChatMessage } from "./openai/openaiTypes";
import type { AnthropicMessage } from "./anthropic/anthropicTypes";
import type { VertexContent } from "./vertex/vertexTypes";
import { InfiniAIModelInfo } from "./types";
import { tryParseJSONObject } from "./utils";
import { getThinkingPartCtor } from "./proposedApi";

export interface ApiUsage {
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cachedTokens?: number;
}

export abstract class CommonApi {
	/** Last usage reported by the model on this request, if any. */
	public lastUsage?: ApiUsage;

	/** Buffer for assembling streamed tool calls by index. */
	protected _toolCallBuffers: Map<number, { id?: string; name?: string; args: string; startInput?: unknown }> = new Map<
		number,
		{ id?: string; name?: string; args: string; startInput?: unknown }
	>();

	/** Indices for which a tool call has been fully emitted. */
	protected _completedToolCallIndices = new Set<number>();

	/** Track if we emitted any assistant text before seeing tool calls (SSE-like begin-tool-calls hint). */
	protected _hasEmittedAssistantText = false;

	/** Track if we emitted the begin-tool-calls whitespace flush. */
	protected _emittedBeginToolCallsHint = false;

	// XML think block parsing state
	protected _xmlThinkActive = false;
	protected _xmlThinkDetectionAttempted = false;
	protected _xmlThinkPending = "";

	// Thinking content state management
	protected _currentThinkingId: string | null = null;

	constructor() {}

	/**
	 * Convert VS Code chat messages to specific api message format.
	 * @param messages The VS Code chat messages to convert.
	 * @param modelConfig Config for special model.
	 * @returns Specific api messages array.
	 */
	abstract convertMessages(
		messages: readonly LanguageModelChatRequestMessage[],
		modelConfig: { includeReasoningInRequest: boolean }
	): Array<OpenAIChatMessage | AnthropicMessage | VertexContent>;

	/**
	 * Construct request body for Specific api
	 * @param rb Specific api Request body
	 * @param um Current Model Info
	 * @param options From VS Code
	 */
	abstract prepareRequestBody(
		rb: any,
		um: InfiniAIModelInfo | undefined,
		options: ProvideLanguageModelChatResponseOptions
	): any;

	/**
	 * Process specific api streaming response (JSON lines format).
	 * @param responseBody The readable stream body.
	 * @param progress Progress reporter for streamed parts.
	 * @param token Cancellation token.
	 */
	abstract processStreamingResponse(
		responseBody: ReadableStream<Uint8Array>,
		progress: Progress<vscode.LanguageModelResponsePart>,
		token: CancellationToken
	): Promise<void>;

	/**
	 * Try to emit a buffered tool call when a valid name and JSON arguments are available.
	 * @param index The tool call index from the stream.
	 * @param progress Progress reporter for parts.
	 */
	protected async tryEmitBufferedToolCall(
		index: number,
		progress: Progress<vscode.LanguageModelResponsePart>
	): Promise<void> {
		const buf = this._toolCallBuffers.get(index);
		if (!buf) {
			return;
		}
		if (!buf.name) {
			return;
		}
		const canParse = tryParseJSONObject(buf.args);
		if (!canParse.ok) {
			return;
		}
		const id = buf.id ?? `call_${Math.random().toString(36).slice(2, 10)}`;
		const parameters = canParse.value;
		progress.report(new LanguageModelToolCallPart(id, buf.name, parameters));
		this.onToolCallEmitted(id);
		this._toolCallBuffers.delete(index);
		this._completedToolCallIndices.add(index);
	}

	/**
	 * Flush all buffered tool calls, optionally throwing if arguments are not valid JSON.
	 * @param progress Progress reporter for parts.
	 * @param throwOnInvalid If true, throw when a tool call has invalid JSON args.
	 */
	protected async flushToolCallBuffers(
		progress: Progress<vscode.LanguageModelResponsePart>,
		throwOnInvalid: boolean
	): Promise<void> {
		if (this._toolCallBuffers.size === 0) {
			return;
		}
		for (const [idx, buf] of Array.from(this._toolCallBuffers.entries())) {
			const parsed = tryParseJSONObject(buf.args);
			const fallbackInput = buf.args.length === 0 && buf.startInput !== undefined ? buf.startInput : undefined;
			if (!parsed.ok && fallbackInput === undefined) {
				if (throwOnInvalid) {
					throw new Error("Invalid JSON for tool call");
				}
				// When not throwing (e.g. on [DONE]), drop silently to reduce noise
				this._toolCallBuffers.delete(idx);
				continue;
			}
			const id = buf.id ?? `call_${Math.random().toString(36).slice(2, 10)}`;
			const name = buf.name ?? "unknown_tool";
			const parameters =
				fallbackInput !== undefined && typeof fallbackInput === "object" && fallbackInput !== null
					? fallbackInput
					: parsed.ok
						? parsed.value
						: {};
			progress.report(new LanguageModelToolCallPart(id, name, parameters));
			this.onToolCallEmitted(id);
			this._toolCallBuffers.delete(idx);
			this._completedToolCallIndices.add(idx);
		}
	}

	protected onToolCallEmitted(_callId: string): void {}

	/**
	 * Report to VS Code for ending thinking
	 */
	protected reportEndThinking() {
		if (!this._currentThinkingId) {
			return;
		}
		this._currentThinkingId = null;
	}

	/**
	 * Generate a unique thinking ID based on request start time and random suffix
	 */
	protected generateThinkingId(): string {
		return `thinking_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
	}

	/**
	 * Track that a reasoning/thinking sequence is active in stable mode.
	 * Thinking content is intentionally not emitted as response parts.
	 * @param text The thinking text chunk observed in the stream
	 */
	protected bufferThinkingContent(text: string, progress?: Progress<vscode.LanguageModelResponsePart>): void {
		if (!text) {
			return;
		}

		// Generate thinking ID if not provided by the model
		if (!this._currentThinkingId) {
			this._currentThinkingId = this.generateThinkingId();
		}

		// Optional UI/transport probe: Marketplace builds do not declare the
		// `languageModelThinkingPart` proposal, but local/custom hosts may still
		// expose `LanguageModelThinkingPart`. If present, emit thinking chunks as
		// response parts for experimentation. Correct replay for MiMo V2 /
		// DeepSeek V4 does not rely on this path; the extension-owned replay store
		// captures and preflights reasoning_content separately.
		const Ctor = getThinkingPartCtor();
		if (Ctor && progress) {
			progress.report(new Ctor(text, this._currentThinkingId) as unknown as vscode.LanguageModelResponsePart);
		}
	}
}
