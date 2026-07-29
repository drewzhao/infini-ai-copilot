import * as vscode from "vscode";
import { RetryConfig } from "./types";
import { OpenAIFunctionToolDef } from "./openai/openaiTypes";
import { normalizeInfiniAIModelsResponse, type NormalizedInfiniAIModelsResponse } from "./modelDiscovery";
import type { RequiredToolChoiceControl } from "./reasoningDialect";

export type InfiniAILogger = vscode.OutputChannel | vscode.LogOutputChannel;

export const INFINIAI_API_KEY_SECRET_NAME = "infiniai.apiKey";

export class HttpError extends Error {
	constructor(
		readonly status: number,
		readonly statusText: string,
		readonly body: string,
		readonly retryAfterMs?: number
	) {
		super(`HTTP ${status} ${statusText}${body ? `: ${body}` : ""}`);
		this.name = "HttpError";
	}
}

export class RateLimitError extends HttpError {
	constructor(statusText: string, body: string, retryAfterMs?: number) {
		super(429, statusText, body, retryAfterMs);
		this.name = "RateLimitError";
	}
}

export class NetworkError extends Error {
	constructor(
		message: string,
		readonly originalError?: unknown
	) {
		super(message);
		this.name = "NetworkError";
	}
}

export class ProviderProtocolError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ProviderProtocolError";
	}
}

export class StreamParseError extends ProviderProtocolError {
	constructor(message: string) {
		super(message);
		this.name = "StreamParseError";
	}
}

function hasLogMethod(
	logger: InfiniAILogger,
	method: "trace" | "debug" | "info" | "warn" | "error"
): logger is vscode.LogOutputChannel {
	return method in logger && typeof (logger as unknown as Record<string, unknown>)[method] === "function";
}

export function logTrace(logger: InfiniAILogger | undefined, message: string): void {
	if (!logger) return;
	if (hasLogMethod(logger, "trace")) logger.trace(message);
	else logger.appendLine(message);
}

export function logDebug(logger: InfiniAILogger | undefined, message: string): void {
	if (!logger) return;
	if (hasLogMethod(logger, "debug")) logger.debug(message);
	else logger.appendLine(message);
}

export function logInfo(logger: InfiniAILogger | undefined, message: string): void {
	if (!logger) return;
	if (hasLogMethod(logger, "info")) logger.info(message);
	else logger.appendLine(message);
}

export function logWarn(logger: InfiniAILogger | undefined, message: string): void {
	if (!logger) return;
	if (hasLogMethod(logger, "warn")) logger.warn(message);
	else logger.appendLine(message);
}

export function logError(logger: InfiniAILogger | undefined, message: string): void {
	if (!logger) return;
	if (hasLogMethod(logger, "error")) logger.error(message);
	else logger.appendLine(message);
}

export function sanitizeForLog(value: string, maxLength = 800): string {
	return value
		.replace(/(authorization|x-api-key)(["':\s]+)(bearer\s+)?[^\s"',}]+/gi, "$1$2[REDACTED]")
		.replace(/(api[_-]?key|token|secret)(["':\s]+)[^\s"',}]+/gi, "$1$2[REDACTED]")
		.slice(0, maxLength);
}

function retryAfterToMs(value: string | null): number | undefined {
	if (!value) {
		return undefined;
	}
	const seconds = Number(value);
	if (Number.isFinite(seconds)) {
		return Math.max(0, seconds * 1000);
	}
	const date = Date.parse(value);
	if (Number.isFinite(date)) {
		return Math.max(0, date - Date.now());
	}
	return undefined;
}

function endpointForLog(url: string): string {
	try {
		const parsed = new URL(url);
		return `${parsed.host}${parsed.pathname}`;
	} catch {
		return sanitizeForLog(url, 160);
	}
}

export async function readHttpErrorResponse(response: Response): Promise<HttpError> {
	let body = "";
	try {
		body = sanitizeForLog(await response.text());
	} catch {
		body = "";
	}
	const retryAfterMs = retryAfterToMs(response.headers.get("retry-after"));
	if (response.status === 429) {
		return new RateLimitError(response.statusText, body, retryAfterMs);
	}
	return new HttpError(response.status, response.statusText, body, retryAfterMs);
}

export async function cancellableDelay(ms: number, token: vscode.CancellationToken): Promise<void> {
	if (ms <= 0) {
		return;
	}
	if (token.isCancellationRequested) {
		throw new vscode.CancellationError();
	}
	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => {
			disposable.dispose();
			resolve();
		}, ms);
		const disposable = token.onCancellationRequested(() => {
			clearTimeout(timeout);
			disposable.dispose();
			reject(new vscode.CancellationError());
		});
	});
}

export async function fetchWithCancellation(
	input: RequestInfo | URL,
	init: RequestInit,
	token: vscode.CancellationToken
): Promise<Response> {
	if (token.isCancellationRequested) {
		throw new vscode.CancellationError();
	}
	const controller = new AbortController();
	const disposable = token.onCancellationRequested(() => controller.abort());
	try {
		return await fetch(input, { ...init, signal: controller.signal });
	} catch (err) {
		if (token.isCancellationRequested || (err instanceof Error && err.name === "AbortError")) {
			throw new vscode.CancellationError();
		}
		const message = err instanceof Error ? err.message : String(err);
		throw new NetworkError(message, err);
	} finally {
		disposable.dispose();
	}
}

export async function promptForApiKey(existing: string | undefined): Promise<string | undefined> {
	const entered = await vscode.window.showInputBox({
		title: vscode.l10n.t("InfiniAI API Key"),
		prompt: existing ? vscode.l10n.t("Update your InfiniAI API key") : vscode.l10n.t("Enter your InfiniAI API key"),
		ignoreFocusOut: true,
		password: true,
		value: existing ?? "",
	});
	return entered?.trim() ? entered.trim() : undefined;
}

export async function configureApiKey(secrets: vscode.SecretStorage): Promise<string | undefined> {
	const existing = await secrets.get(INFINIAI_API_KEY_SECRET_NAME);
	const apiKey = await promptForApiKey(existing);
	if (apiKey) {
		await secrets.store(INFINIAI_API_KEY_SECRET_NAME, apiKey);
	}
	return apiKey;
}

/**
 * Ensure an API key exists in SecretStorage, optionally prompting the user when not silent.
 * @param silent If true, do not prompt the user.
 * @param secrets vscode.SecretStorage
 */
export async function ensureApiKey(silent: boolean, secrets: vscode.SecretStorage): Promise<string | undefined> {
	const apiKey = await secrets.get(INFINIAI_API_KEY_SECRET_NAME);
	if (apiKey || silent) {
		return apiKey;
	}
	return configureApiKey(secrets);
}

/**
 * Fetch the list of models from InfiniAI API.
 * @param apiKey The InfiniAI API key used to authenticate.
 */
export async function fetchModels(
	apiKey: string,
	userAgent: string,
	output: InfiniAILogger,
	token: vscode.CancellationToken
): Promise<NormalizedInfiniAIModelsResponse> {
	const configured = vscode.workspace.getConfiguration("infiniai").get<string>("modelDiscoveryUrl", "").trim();
	const modelsUrl = configured || "https://cloud.infini-ai.com/maas/v1/models";
	logInfo(output, `Fetching models from ${endpointForLog(modelsUrl)}`);

	const modelsList = (async () => {
		const resp = await fetchWithCancellation(
			modelsUrl,
			{
				method: "GET",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"User-Agent": userAgent,
				},
			},
			token
		);
		if (!resp.ok) {
			throw await readHttpErrorResponse(resp);
		}
		const normalized = normalizeInfiniAIModelsResponse(await resp.json());
		if (!normalized.ok) {
			throw new ProviderProtocolError(normalized.error);
		}
		const result = normalized.value;
		logInfo(output, `Parsed ${result.models.length} unique models from ${result.rawModelCount} API rows`);
		if (result.malformedModelCount > 0 || result.duplicateModelCount > 0) {
			logWarn(
				output,
				`Ignored ${result.malformedModelCount} malformed and ${result.duplicateModelCount} duplicate model rows`
			);
		}
		return result;
	})();

	try {
		return await modelsList;
	} catch (err) {
		if (err instanceof Error) {
			logError(output, `Failed to fetch InfiniAI models: ${sanitizeForLog(err.message)}`);
		} else {
			logError(output, `Failed to fetch InfiniAI models: ${sanitizeForLog(String(err))}`);
		}
		throw err;
	}
}

/**
 * Try to parse a JSON object from a string.
 * @param text The input string.
 * @returns Parsed object or ok:false.
 */
export function tryParseJSONObject(text: string): { ok: true; value: Record<string, unknown> } | { ok: false } {
	try {
		if (!text || !/[{]/.test(text)) {
			return { ok: false };
		}
		const value = JSON.parse(text);
		if (value && typeof value === "object" && !Array.isArray(value)) {
			return { ok: true, value };
		}
		return { ok: false };
	} catch {
		return { ok: false };
	}
}

/**
 * 检查是否为图片MIME类型
 */
export function isImageMimeType(mimeType: string): boolean {
	return mimeType.startsWith("image/") && ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mimeType);
}

/**
 * Type guard for LanguageModelToolResultPart-like values.
 * @param value Unknown value to test.
 */
export function isToolResultPart(value: unknown): value is { callId: string; content?: ReadonlyArray<unknown> } {
	if (!value || typeof value !== "object") {
		return false;
	}
	const obj = value as Record<string, unknown>;
	const hasCallId = typeof obj.callId === "string";
	const hasContent = "content" in obj;
	return hasCallId && hasContent;
}

/**
 * Concatenate tool result content into a single text string.
 * @param pr Tool result-like object with content array.
 */
export function collectToolResultText(pr: { content?: ReadonlyArray<unknown> }): string {
	let text = "";
	for (const c of pr.content ?? []) {
		if (c instanceof vscode.LanguageModelTextPart) {
			text += c.value;
		} else if (typeof c === "string") {
			text += c;
		} else if (c instanceof vscode.LanguageModelDataPart && c.mimeType === "cache_control") {
			/* ignore */
		} else {
			try {
				text += JSON.stringify(c);
			} catch {
				/* ignore */
			}
		}
	}
	return text;
}

/**
 * Convert VS Code tool definitions to OpenAI function tool definitions.
 * @param options Request options containing tools and toolMode.
 */
export function convertToolsToOpenAI(
	options: vscode.ProvideLanguageModelChatResponseOptions,
	requiredToolChoiceControl: RequiredToolChoiceControl = "specified-function"
): {
	tools?: OpenAIFunctionToolDef[];
	tool_choice?: "auto" | "required" | { type: "function"; function: { name: string } };
} {
	const tools = options.tools ?? [];
	if (!tools || tools.length === 0) {
		return {};
	}

	const toolDefs: OpenAIFunctionToolDef[] = tools
		.filter((t) => t && typeof t === "object")
		.map((t) => {
			const name = t.name;
			const description = typeof t.description === "string" ? t.description : "";
			const params = t.inputSchema ?? { type: "object", properties: {} };
			return {
				type: "function" as const,
				function: {
					name,
					description,
					parameters: params,
				},
			} satisfies OpenAIFunctionToolDef;
		});

	let tool_choice: "auto" | "required" | { type: "function"; function: { name: string } } = "auto";
	if (options.toolMode === vscode.LanguageModelChatToolMode.Required) {
		if (requiredToolChoiceControl === "unsupported") {
			throw new Error("LanguageModelChatToolMode.Required is not supported by this model profile");
		}
		if (requiredToolChoiceControl === "required-string") {
			tool_choice = "required";
		} else {
			if (tools.length !== 1) {
				throw new Error("LanguageModelChatToolMode.Required is not supported with more than one tool");
			}
			tool_choice = { type: "function", function: { name: tools[0].name } };
		}
	}

	return { tools: toolDefs, tool_choice };
}

/**
 * Map VS Code message role to OpenAI message role string.
 * @param message The message whose role is mapped.
 */
export function mapRole(message: vscode.LanguageModelChatRequestMessage): "user" | "assistant" | "system" {
	const USER = vscode.LanguageModelChatMessageRole.User as unknown as number;
	const ASSISTANT = vscode.LanguageModelChatMessageRole.Assistant as unknown as number;
	const r = message.role as unknown as number;
	if (r === USER) {
		return "user";
	}
	if (r === ASSISTANT) {
		return "assistant";
	}
	return "system";
}

/**
 * 创建图片的data URL
 */
export function createDataUrl(dataPart: vscode.LanguageModelDataPart): string {
	const base64Data = Buffer.from(dataPart.data).toString("base64");
	return `data:${dataPart.mimeType};base64,${base64Data}`;
}

/**
 * Create retry configuration from VS Code workspace settings.
 * @returns Retry configuration with default values.
 */
export function createRetryConfig(): RetryConfig {
	const config = vscode.workspace.getConfiguration();
	const retryConfig = config.get<RetryConfig>("infiniai.retry", {
		enabled: true,
		max_attempts: RETRY_MAX_ATTEMPTS,
		interval_ms: RETRY_INTERVAL_MS,
	});

	return {
		enabled: retryConfig.enabled ?? true,
		max_attempts: retryConfig.max_attempts ?? RETRY_MAX_ATTEMPTS,
		interval_ms: retryConfig.interval_ms ?? RETRY_INTERVAL_MS,
		status_codes: retryConfig.status_codes,
	};
}

const RETRY_MAX_ATTEMPTS = 3;
const RETRY_INTERVAL_MS = 1000;

// HTTP status codes that should trigger a retry.
const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

/**
 * Execute a function with retry logic for rate limiting.
 * @param fn The async function to execute
 * @param retryConfig Retry configuration
 * @returns Result of the function execution
 */
export async function executeWithRetry<T>(
	fn: (attempt: number) => Promise<T>,
	retryConfig: RetryConfig,
	token: vscode.CancellationToken,
	output?: InfiniAILogger
): Promise<T> {
	if (!retryConfig.enabled) {
		return await fn(1);
	}

	const maxAttempts = Math.max(1, retryConfig.max_attempts ?? RETRY_MAX_ATTEMPTS);
	const intervalMs = retryConfig.interval_ms ?? RETRY_INTERVAL_MS;
	// Merge user-configured status codes with default ones, removing duplicates
	const retryableStatusCodes = retryConfig.status_codes
		? [...new Set([...RETRYABLE_STATUS_CODES, ...retryConfig.status_codes])]
		: RETRYABLE_STATUS_CODES;
	let lastError: Error | undefined;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		if (token.isCancellationRequested) {
			throw new vscode.CancellationError();
		}
		try {
			return await fn(attempt);
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			if (lastError instanceof vscode.CancellationError) {
				throw lastError;
			}

			const isNetworkError = lastError instanceof NetworkError;
			const isRetryableError =
				(lastError instanceof HttpError && retryableStatusCodes.includes(lastError.status)) || isNetworkError;

			if (!isRetryableError || attempt >= maxAttempts) {
				throw lastError;
			}

			const waitMs =
				lastError instanceof HttpError && lastError.retryAfterMs !== undefined ? lastError.retryAfterMs : intervalMs;
			logWarn(output, `Retryable error detected; retrying in ${waitMs}ms (attempt ${attempt}/${maxAttempts})`);

			await cancellableDelay(waitMs, token);
		}
	}

	// This should never be reached, but TypeScript needs it
	throw lastError || new Error("Retry failed");
}
