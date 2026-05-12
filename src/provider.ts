import * as vscode from "vscode";
import {
	CancellationToken,
	LanguageModelChatInformation,
	LanguageModelChatProvider,
	LanguageModelChatRequestMessage,
	ProvideLanguageModelChatResponseOptions,
	Progress,
} from "vscode";

import { AnthropicApi } from "./anthropic/anthropicApi";
import { AnthropicRequestBody } from "./anthropic/anthropicTypes";
import { OpenaiApi } from "./openai/openaiApi";
import { prepareTokenCount } from "./provideToken";
import { resolveModelRoute } from "./route";
import { updateContextStatusBar } from "./statusBar";
import { InfiniAIModelInfo, ModelRoute, ModelRouteConfig } from "./types";
import {
	cancellableDelay,
	createRetryConfig,
	ensureApiKey,
	executeWithRetry,
	fetchModels,
	fetchWithCancellation,
	getActivePlan,
	InfiniAILogger,
	logDebug,
	logError,
	logInfo,
	logWarn,
	readHttpErrorResponse,
	sanitizeForLog,
} from "./utils";
import { VertexApi } from "./vertex/vertexApi";
import { VertexRequestBody } from "./vertex/vertexTypes";
import { resolveImageInputCapability } from "./modelCapabilities";
import { parseModelRouteConfigs } from "./route";

const DEFAULT_CONTEXT_LENGTH = 128000;
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_CACHE_TTL_MS = 300000;

interface ModelCacheEntry {
	key: string;
	models: InfiniAIModelInfo[];
	infos: LanguageModelChatInformation[];
	routes: Map<string, ModelRoute>;
	fetchedAt: number;
	lastError?: string;
}

interface DiagnosticSnapshot {
	vscodeVersion: string;
	plan: string;
	hasStandardKey: boolean;
	hasCodingKey: boolean;
	modelCount: number;
	cacheAgeMs?: number;
	modelDiscoveryUrl: string;
	lastError?: string;
}

function hashString(value: string): string {
	let hash = 2166136261;
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16);
}

function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, "");
}

function safeEndpointLabel(url: string): string {
	try {
		const parsed = new URL(url);
		return `${parsed.host}${parsed.pathname}`;
	} catch {
		return sanitizeForLog(url, 160);
	}
}

function lowerIncludes(value: string | undefined, needle: string): boolean {
	return value?.toLowerCase().includes(needle) ?? false;
}

export interface ChatUsageEvent {
	readonly modelId: string;
	readonly transport: string;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cachedTokens?: number;
	readonly timestamp: number;
}

/**
 * VS Code Chat provider backed by InfiniAI Inference Providers.
 */
export class InfiniAIChatModelProvider implements LanguageModelChatProvider, vscode.Disposable {
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation = this._onDidChange.event;

	private readonly _onDidConsumeUsage = new vscode.EventEmitter<ChatUsageEvent>();
	readonly onDidConsumeUsage = this._onDidConsumeUsage.event;

	private _lastRequestTime: number | null = null;
	private _cache?: ModelCacheEntry;
	private _lastGoodCache?: ModelCacheEntry;
	private _modelsFetchPromise?: Promise<ModelCacheEntry>;
	private _modelsFetchPromiseKey?: string;
	private _lastError?: string;

	constructor(
		private readonly secrets: vscode.SecretStorage,
		private readonly userAgent: string,
		private readonly statusBarItem: vscode.StatusBarItem,
		private readonly output: InfiniAILogger
	) {}

	dispose(): void {
		this._onDidChange.dispose();
		this._onDidConsumeUsage.dispose();
	}

	refreshModels(): void {
		this._cache = undefined;
		this._modelsFetchPromise = undefined;
		this._modelsFetchPromiseKey = undefined;
		this._onDidChange.fire();
	}

	async provideLanguageModelChatInformation(
		options: vscode.PrepareLanguageModelChatModelOptions,
		token: CancellationToken
	): Promise<LanguageModelChatInformation[]> {
		try {
			const apiKey = await ensureApiKey(options.silent, this.secrets);
			if (!apiKey) {
				if (options.silent) {
					return [];
				}
				throw new Error("InfiniAI API key not found");
			}
			const entry = await this.getModelCache(apiKey, options.silent, token);
			return entry.infos;
		} catch (err) {
			this._lastError = err instanceof Error ? err.message : String(err);
			logError(this.output, `Failed to provide model information: ${sanitizeForLog(this._lastError)}`);
			if (options.silent) {
				return this._lastGoodCache?.infos ?? [];
			}
			throw err;
		}
	}

	async provideLanguageModelChatResponse(
		model: LanguageModelChatInformation,
		messages: readonly LanguageModelChatRequestMessage[],
		options: ProvideLanguageModelChatResponseOptions,
		progress: Progress<vscode.LanguageModelResponsePart>,
		token: CancellationToken
	): Promise<void> {
		void updateContextStatusBar(messages, model, this.statusBarItem).catch((err) => {
			logDebug(
				this.output,
				`Status bar update failed: ${sanitizeForLog(err instanceof Error ? err.message : String(err))}`
			);
		});

		const streamedProgress = this.createTrackingProgress(model, progress);

		try {
			await this.applyRequestDelay(token);
			const apiKey = await ensureApiKey(false, this.secrets);
			if (!apiKey) {
				throw new Error("InfiniAI API key not found");
			}

			const cache = await this.getModelCache(apiKey, false, token);
			const infiniAIModel = cache.models.find((m) => m.id === model.id);
			const route =
				cache.routes.get(model.id) ?? resolveModelRoute(this.toModelInfo(model, infiniAIModel), this.getRouteConfigs());

			logInfo(
				this.output,
				`Starting request model=${model.id} transport=${route.transport} endpoint=${safeEndpointLabel(route.baseUrl)}`
			);

			if (route.transport === "anthropic") {
				await this.runAnthropicRequest(model, messages, options, streamedProgress, token, apiKey, infiniAIModel, route);
			} else if (route.transport === "vertex") {
				await this.runVertexRequest(model, messages, options, streamedProgress, token, apiKey, infiniAIModel, route);
			} else {
				await this.runOpenAIRequest(model, messages, options, streamedProgress, token, apiKey, infiniAIModel, route);
			}
		} catch (err) {
			if (!(err instanceof vscode.CancellationError)) {
				this._lastError = err instanceof Error ? err.message : String(err);
				logError(this.output, `Chat request failed model=${model.id} error=${sanitizeForLog(this._lastError)}`);
			}
			throw err;
		} finally {
			this._lastRequestTime = Date.now();
		}
	}

	async provideTokenCount(
		model: LanguageModelChatInformation,
		text: string | LanguageModelChatRequestMessage,
		token: CancellationToken
	): Promise<number> {
		return prepareTokenCount(model, text, token);
	}

	async getDiagnostics(token: CancellationToken): Promise<DiagnosticSnapshot> {
		const plan = getActivePlan();
		const standardKey = await this.secrets.get("infiniai.apiKey");
		const codingKey = await this.secrets.get("infiniai.codingApiKey");
		const discoveryUrl = this.getModelDiscoveryUrl();
		let modelCount = this._lastGoodCache?.infos.length ?? 0;
		if (!modelCount && !token.isCancellationRequested) {
			const apiKey = plan === "coding" ? codingKey : standardKey;
			if (apiKey) {
				const entry = await this.getModelCache(apiKey, true, token);
				modelCount = entry.infos.length;
			}
		}
		return {
			vscodeVersion: vscode.version,
			plan,
			hasStandardKey: !!standardKey,
			hasCodingKey: !!codingKey,
			modelCount,
			cacheAgeMs: this._lastGoodCache ? Date.now() - this._lastGoodCache.fetchedAt : undefined,
			modelDiscoveryUrl: discoveryUrl,
			lastError: this._lastError,
		};
	}

	async getModelDescriptions(
		refresh: boolean,
		token: CancellationToken
	): Promise<
		Array<{
			id: string;
			transport: string;
			toolCalling: boolean | number | undefined;
			imageInput: boolean | undefined;
			maxInputTokens: number;
			maxOutputTokens: number;
		}>
	> {
		const apiKey = await ensureApiKey(false, this.secrets);
		if (!apiKey) {
			return [];
		}
		const entry = await this.getModelCache(apiKey, false, token, refresh);
		return entry.infos.map((info) => ({
			id: info.id,
			transport: entry.routes.get(info.id)?.transport ?? "openai",
			toolCalling: info.capabilities.toolCalling,
			imageInput: info.capabilities.imageInput,
			maxInputTokens: info.maxInputTokens,
			maxOutputTokens: info.maxOutputTokens,
		}));
	}

	async testRoute(prompt: string, token: CancellationToken): Promise<string> {
		const apiKey = await ensureApiKey(false, this.secrets);
		if (!apiKey) {
			throw new Error("InfiniAI API key not found");
		}
		const entry = await this.getModelCache(apiKey, false, token);
		const first = entry.infos[0];
		if (!first) {
			throw new Error("No InfiniAI models are available");
		}
		const model = entry.models.find((m) => m.id === first.id);
		const route =
			entry.routes.get(first.id) ?? resolveModelRoute(this.toModelInfo(first, model), this.getRouteConfigs());
		const body = this.createTestRequestBody(first.id, prompt || "Reply with OK.", route.transport);
		const response = await this.postJsonWithRetry(
			this.requestUrl(route, first.id),
			this.requestHeaders(route, apiKey),
			body,
			token
		);
		await response.body?.cancel();
		return `OK: ${first.id} via ${route.transport} (${response.status})`;
	}

	private createTrackingProgress(
		model: LanguageModelChatInformation,
		progress: Progress<vscode.LanguageModelResponsePart>
	): Progress<vscode.LanguageModelResponsePart> {
		return {
			report: (part) => {
				try {
					progress.report(part);
				} catch (err) {
					logWarn(
						this.output,
						`Progress.report failed model=${model.id} error=${sanitizeForLog(err instanceof Error ? err.message : String(err))}`
					);
				}
			},
		};
	}

	private async getModelCache(
		apiKey: string,
		silent: boolean,
		token: CancellationToken,
		force = false
	): Promise<ModelCacheEntry> {
		const key = this.buildCacheKey(apiKey);
		const ttl = this.getCacheTtlMs();
		if (!force && this._cache?.key === key && (ttl === 0 ? false : Date.now() - this._cache.fetchedAt < ttl)) {
			return this._cache;
		}
		if (!force && silent && this._lastGoodCache?.key === key) {
			return this._lastGoodCache;
		}
		if (!force && this._modelsFetchPromise && this._modelsFetchPromiseKey === key) {
			return this._modelsFetchPromise;
		}

		this._modelsFetchPromiseKey = key;
		const fetchPromise = silent
			? this.fetchAndNormalizeModels(apiKey, key, token)
			: this.fetchAndNormalizeModelsWithProgress(apiKey, key, token);
		this._modelsFetchPromise = fetchPromise
			.then((entry) => {
				this._cache = entry;
				this._lastGoodCache = entry;
				this._lastError = undefined;
				this._onDidChange.fire();
				return entry;
			})
			.catch((err) => {
				this._lastError = err instanceof Error ? err.message : String(err);
				if (silent && this._lastGoodCache?.key === key) {
					return this._lastGoodCache;
				}
				throw err;
			})
			.finally(() => {
				this._modelsFetchPromise = undefined;
				this._modelsFetchPromiseKey = undefined;
			});
		return this._modelsFetchPromise;
	}

	private async fetchAndNormalizeModelsWithProgress(
		apiKey: string,
		key: string,
		token: CancellationToken
	): Promise<ModelCacheEntry> {
		return vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: vscode.l10n.t("InfiniAI: Fetching available models…"),
				cancellable: true,
			},
			async (_progress, progressToken) => {
				const linked = new vscode.CancellationTokenSource();
				const sub1 = token.onCancellationRequested(() => linked.cancel());
				const sub2 = progressToken.onCancellationRequested(() => linked.cancel());
				try {
					return await this.fetchAndNormalizeModels(apiKey, key, linked.token);
				} finally {
					sub1.dispose();
					sub2.dispose();
					linked.dispose();
				}
			}
		);
	}

	private async fetchAndNormalizeModels(
		apiKey: string,
		key: string,
		token: CancellationToken
	): Promise<ModelCacheEntry> {
		const { models } = await fetchModels(apiKey, this.userAgent, this.output, token);
		const routeConfigs = this.getRouteConfigs();
		const routes = new Map<string, ModelRoute>();
		const infos = models.map((model) => {
			const route = resolveModelRoute(model, routeConfigs);
			routes.set(model.id, route);
			return this.toLanguageModelInfo(model, route);
		});
		logInfo(this.output, `Fetched ${models.length} models from InfiniAI API`);
		return {
			key,
			models,
			infos,
			routes,
			fetchedAt: Date.now(),
		};
	}

	private toLanguageModelInfo(model: InfiniAIModelInfo, route: ModelRoute): LanguageModelChatInformation {
		const contextLength = model.context_length ?? this.inferContextLength(model.id) ?? DEFAULT_CONTEXT_LENGTH;
		const maxOutput = model.max_tokens ?? DEFAULT_MAX_TOKENS;
		const maxInput = Math.max(1, contextLength - maxOutput);
		const cfg = vscode.workspace.getConfiguration("infiniai");
		const enablePatterns = cfg.get<string[]>("imageInputModels", []);
		const disablePatterns = cfg.get<string[]>("disableImageInputModels", []);

		return {
			id: model.id,
			name: model.id,
			tooltip: `InfiniAI Model ${model.id}`,
			detail: `InfiniAI ${route.transport}`,
			family: model.family ?? route.endpointKind,
			version: model.created?.toString() || "1.0.0",
			maxInputTokens: maxInput,
			maxOutputTokens: maxOutput,
			capabilities: {
				toolCalling: !model.id.includes("embed") && !model.id.includes("reranker"),
				imageInput: resolveImageInputCapability(model, { enablePatterns, disablePatterns }),
			},
		};
	}

	private toModelInfo(
		model: LanguageModelChatInformation,
		infiniAIModel: InfiniAIModelInfo | undefined
	): InfiniAIModelInfo {
		return (
			infiniAIModel ?? {
				id: model.id,
				object: "model",
				created: Number(model.version) || 0,
				owned_by: "infiniai",
				family: model.family,
				context_length: model.maxInputTokens + model.maxOutputTokens,
				max_tokens: model.maxOutputTokens,
			}
		);
	}

	private async runOpenAIRequest(
		model: LanguageModelChatInformation,
		messages: readonly LanguageModelChatRequestMessage[],
		options: ProvideLanguageModelChatResponseOptions,
		progress: Progress<vscode.LanguageModelResponsePart>,
		token: CancellationToken,
		apiKey: string,
		infiniAIModel: InfiniAIModelInfo | undefined,
		route: ModelRoute
	): Promise<void> {
		const openaiApi = new OpenaiApi();
		const openaiMessages = openaiApi.convertMessages(messages, { includeReasoningInRequest: false });
		let requestBody: Record<string, unknown> = {
			model: model.id,
			messages: openaiMessages,
			stream: true,
			stream_options: { include_usage: true },
		};
		requestBody = openaiApi.prepareRequestBody(requestBody, infiniAIModel, options);
		const response = await this.postJsonWithRetry(
			this.requestUrl(route, model.id),
			this.requestHeaders(route, apiKey),
			requestBody,
			token
		);
		if (!response.body) {
			throw new Error("No response body from InfiniAI API");
		}
		await openaiApi.processStreamingResponse(response.body, progress, token);
		this.fireUsage(model, route, openaiApi.lastUsage);
	}

	private async runAnthropicRequest(
		model: LanguageModelChatInformation,
		messages: readonly LanguageModelChatRequestMessage[],
		options: ProvideLanguageModelChatResponseOptions,
		progress: Progress<vscode.LanguageModelResponsePart>,
		token: CancellationToken,
		apiKey: string,
		infiniAIModel: InfiniAIModelInfo | undefined,
		route: ModelRoute
	): Promise<void> {
		const anthropicApi = new AnthropicApi();
		const anthropicMessages = anthropicApi.convertMessages(messages, {
			includeReasoningInRequest: false,
			supportParameters: "",
		});
		let requestBody: AnthropicRequestBody = {
			model: model.id,
			messages: anthropicMessages,
			stream: true,
			max_tokens: model.maxOutputTokens || DEFAULT_MAX_TOKENS,
		};
		requestBody = anthropicApi.prepareRequestBody(requestBody, infiniAIModel, options);
		const response = await this.postJsonWithRetry(
			this.requestUrl(route, model.id),
			this.requestHeaders(route, apiKey),
			requestBody,
			token
		);
		if (!response.body) {
			throw new Error("No response body from Anthropic API");
		}
		await anthropicApi.processStreamingResponse(response.body, progress, token);
		this.fireUsage(model, route, anthropicApi.lastUsage);
	}

	private async runVertexRequest(
		model: LanguageModelChatInformation,
		messages: readonly LanguageModelChatRequestMessage[],
		options: ProvideLanguageModelChatResponseOptions,
		progress: Progress<vscode.LanguageModelResponsePart>,
		token: CancellationToken,
		apiKey: string,
		infiniAIModel: InfiniAIModelInfo | undefined,
		route: ModelRoute
	): Promise<void> {
		const vertexApi = new VertexApi();
		const contents = vertexApi.convertMessages(messages, { includeReasoningInRequest: false });
		let requestBody: VertexRequestBody = {
			contents,
			generationConfig: {
				maxOutputTokens: model.maxOutputTokens || DEFAULT_MAX_TOKENS,
			},
		};
		requestBody = vertexApi.prepareRequestBody(requestBody, infiniAIModel, options);
		const response = await this.postJsonWithRetry(
			this.requestUrl(route, model.id),
			this.requestHeaders(route, apiKey),
			requestBody,
			token
		);
		if (!response.body) {
			throw new Error("No response body from Vertex API");
		}
		await vertexApi.processStreamingResponse(response.body, progress, token);
		this.fireUsage(model, route, vertexApi.lastUsage);
	}

	private fireUsage(
		model: LanguageModelChatInformation,
		route: ModelRoute,
		usage: { inputTokens: number; outputTokens: number; cachedTokens?: number } | undefined
	): void {
		if (!usage) {
			return;
		}
		this._onDidConsumeUsage.fire({
			modelId: model.id,
			transport: route.transport,
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens,
			cachedTokens: usage.cachedTokens,
			timestamp: Date.now(),
		});
	}

	private requestUrl(route: ModelRoute, modelId: string): string {
		const baseUrl = normalizeBaseUrl(route.baseUrl);
		if (route.transport === "anthropic") {
			return `${baseUrl}/v1/messages`;
		}
		if (route.transport === "vertex") {
			return `${baseUrl}/models/${encodeURIComponent(modelId)}:streamGenerateContent`;
		}
		return `${baseUrl}/chat/completions`;
	}

	private requestHeaders(route: ModelRoute, apiKey: string): Record<string, string> {
		if (route.transport === "anthropic") {
			return {
				"Content-Type": "application/json",
				"User-Agent": this.userAgent,
				"x-api-key": apiKey,
				"anthropic-version": "2023-06-01",
			};
		}
		return {
			"Content-Type": "application/json",
			"User-Agent": this.userAgent,
			Authorization: `Bearer ${apiKey}`,
		};
	}

	private async postJsonWithRetry(
		url: string,
		headers: Record<string, string>,
		body: unknown,
		token: CancellationToken
	): Promise<Response> {
		return executeWithRetry(
			async (attempt) => {
				const started = Date.now();
				logDebug(this.output, `POST ${safeEndpointLabel(url)} attempt=${attempt}`);
				const response = await fetchWithCancellation(
					url,
					{
						method: "POST",
						headers,
						body: JSON.stringify(body),
					},
					token
				);
				logDebug(
					this.output,
					`POST ${safeEndpointLabel(url)} status=${response.status} elapsedMs=${Date.now() - started}`
				);
				if (!response.ok) {
					throw await readHttpErrorResponse(response);
				}
				return response;
			},
			createRetryConfig(),
			token,
			this.output
		);
	}

	private createTestRequestBody(modelId: string, prompt: string, transport: string): unknown {
		if (transport === "anthropic") {
			return {
				model: modelId,
				messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
				stream: true,
				max_tokens: 16,
			};
		}
		if (transport === "vertex") {
			return {
				contents: [{ role: "user", parts: [{ text: prompt }] }],
				generationConfig: { maxOutputTokens: 16 },
			};
		}
		return {
			model: modelId,
			messages: [{ role: "user", content: prompt }],
			stream: true,
			max_tokens: 16,
		};
	}

	private async applyRequestDelay(token: CancellationToken): Promise<void> {
		const config = vscode.workspace.getConfiguration();
		const delayMs = config.get<number>("infiniai.delay", 0);
		if (delayMs > 0 && this._lastRequestTime !== null) {
			const elapsed = Date.now() - this._lastRequestTime;
			if (elapsed < delayMs) {
				await cancellableDelay(delayMs - elapsed, token);
			}
		}
	}

	private buildCacheKey(apiKey: string): string {
		const cfg = vscode.workspace.getConfiguration("infiniai");
		const routeConfig = JSON.stringify(cfg.get<ModelRouteConfig[]>("modelRoutes", []));
		const imageConfig = JSON.stringify({
			enable: cfg.get<string[]>("imageInputModels", []),
			disable: cfg.get<string[]>("disableImageInputModels", []),
		});
		return [
			getActivePlan(),
			this.getModelDiscoveryUrl(),
			hashString(apiKey),
			hashString(routeConfig),
			hashString(imageConfig),
		].join("|");
	}

	private getModelDiscoveryUrl(): string {
		const plan = getActivePlan();
		const configured = vscode.workspace.getConfiguration("infiniai").get<string>("modelDiscoveryUrl", "").trim();
		if (configured) {
			return configured;
		}
		return `https://cloud.infini-ai.com/maas${plan === "coding" ? "/coding" : ""}/v1/models`;
	}

	private getCacheTtlMs(): number {
		return Math.max(
			0,
			vscode.workspace.getConfiguration("infiniai").get<number>("modelCacheTtlMs", DEFAULT_CACHE_TTL_MS)
		);
	}

	private getRouteConfigs(): ModelRouteConfig[] {
		return parseModelRouteConfigs(vscode.workspace.getConfiguration("infiniai").get<unknown>("modelRoutes", []));
	}

	private inferContextLength(modelId: string): number | undefined {
		if (modelId.includes("128k")) return 128000;
		if (modelId.includes("32k")) return 32000;
		if (modelId.includes("16k")) return 16000;
		if (modelId.includes("8k")) return 8000;
		if (modelId.includes("4k")) return 4000;
		if (modelId.includes("qwen3") || modelId.includes("deepseek-v3")) return 128000;
		if (modelId.includes("glm-4.5v")) return 64000;
		if (modelId.includes("glm-4.6v") || modelId.includes("glm-4.5-air") || modelId.includes("glm-4.5")) return 128000;
		if (modelId.includes("glm-4.6") || modelId.includes("glm-4.7")) return 200000;
		if (modelId.includes("glm-5")) return 198000;
		if (modelId.includes("minimax-m")) return 200000;
		if (
			lowerIncludes(modelId, "kimi-k2.5") ||
			lowerIncludes(modelId, "kimi-k2-instruct") ||
			lowerIncludes(modelId, "kimi-k2-thinking")
		) {
			return 256000;
		}
		return undefined;
	}
}
