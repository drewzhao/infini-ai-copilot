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
import type {
	AnthropicContentBlock,
	AnthropicMessage,
	AnthropicRequestBody,
	AnthropicThinkingBlock,
	AnthropicToolUseBlock,
} from "./anthropic/anthropicTypes";
import { enrichModelWithBuiltInMetadata, inferModelFamily } from "./catalogMetadata";
import { categorizeError, surfaceActionableError, type ErrorCategory } from "./errorActions";
import { makeUserSelectableLanguageModelInfo } from "./grayLanguageModelMetadata";
import {
	formatInfiniAIModelType,
	resolveInfiniAIModelVersion,
	selectInfiniAIChatModels,
	type NormalizedInfiniAIModelsResponse,
} from "./modelDiscovery";
import {
	appendModelConfigurationSummaryToTooltip,
	buildInfiniAIModelConfigurationSchema,
	resolveInfiniAIModelConfiguration,
} from "./modelConfiguration";
import { OpenaiApi } from "./openai/openaiApi";
import type { OpenAIChatMessage } from "./openai/openaiTypes";
import { prepareTokenCount } from "./provideToken";
import { hasThinkingPartApi } from "./proposedApi";
import { resolveReasoningDialectProfile } from "./reasoningDialect";
import { applyReasoningRequestControls, buildReplayPreservationRequestControls } from "./reasoningRequest";
import { applyAnthropicThinkingReplay, applyThinkingReplay, decideThinkingReplayRequest } from "./thinkingReplay";
import { buildOpenAIReplayHistoryKey, isStoredReplayCarrier, thinkingReplayStore } from "./thinkingReplayStore";
import { countModelRouteOverrides, resolveModelRoute } from "./route";
import { updateContextStatusBar } from "./statusBar";
import { getVisibleInfiniAITestModels } from "./testModelSelection";
import { computeLanguageModelTokenBudget } from "./tokenBudget";
import {
	getDisableThinkingPatterns,
	getThinkingRoundTripPatterns,
	shouldDisableThinking,
	shouldEnableThinkingRoundTrip,
} from "./thinkingMode";
import {
	getDefaultRequestThinkingMode,
	shouldCaptureDisabledThinkingObservation,
	shouldHonorThinkingRoundTripForProfile,
	shouldRequireThinkingReplayByProfile,
} from "./thinkingPolicy";
import { InfiniAIModelInfo, ModelRoute, ModelRouteConfig } from "./types";
import {
	cancellableDelay,
	createRetryConfig,
	executeWithRetry,
	fetchModels,
	fetchWithCancellation,
	HttpError,
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
import {
	resolveImageInputCapability,
	resolveToolCallingCapability,
	VERIFIED_TOOL_CALLING_MODEL_PATTERNS,
} from "./modelCapabilities";
import { isModelHidden } from "./modelVisibility";
import { readProviderApiKey, readProviderGroupName } from "./providerConfiguration";
import { parseModelRouteConfigs } from "./route";

const DEFAULT_CONTEXT_LENGTH = 128000;
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_CACHE_TTL_MS = 300000;
const DISCOVERY_FAILURE_BACKOFF_BASE_MS = 15000;
const DISCOVERY_FAILURE_BACKOFF_MAX_MS = 120000;
const DISCOVERY_PROTOCOL_BACKOFF_MS = 300000;

interface ModelCacheEntry {
	key: string;
	models: InfiniAIModelInfo[];
	infos: LanguageModelChatInformation[];
	routes: Map<string, ModelRoute>;
	discoveryStats: ModelDiscoveryStats;
	fetchedAt: number;
	signature: string;
}

interface ModelDiscoveryOperation {
	readonly promise: Promise<ModelCacheEntry>;
	readonly cancellation: vscode.CancellationTokenSource;
}

interface ModelDiscoveryFailure {
	readonly error: Error;
	readonly category: ErrorCategory;
	readonly failedAt: number;
	readonly retryAt: number;
	readonly failureCount: number;
}

interface ProviderGroupState {
	readonly name: string;
	readonly apiKey: string;
	readonly cacheKey: string;
}

type ModelCredentialBinding = ProviderGroupState;

interface ModelDiscoveryStats {
	rawModelCount: number;
	chatModelCount: number;
	nonChatModelCount: number;
	unknownModelTypeCount: number;
	malformedModelCount: number;
	duplicateModelCount: number;
	liveOutputLimitCount: number;
}

interface InfiniAITestModelPick extends vscode.QuickPickItem {
	readonly info: LanguageModelChatInformation;
}

interface DiagnosticSnapshot {
	vscodeVersion: string;
	providerGroupCount: number;
	modelCount: number;
	discoveryStats?: ModelDiscoveryStats;
	routeConfigCount: number;
	exactModelRouteOverrideCount: number;
	cacheAgeMs?: number;
	modelDiscoveryUrl: string;
	lastError?: string;
	groups: readonly ProviderGroupDiagnostic[];
}

export interface ProviderGroupDiagnostic {
	readonly name: string;
	readonly modelCount: number;
	readonly cacheAgeMs?: number;
	readonly lastError?: string;
	readonly retryAt?: number;
}

export interface InfiniAIModelDescription {
	id: string;
	group: string;
	transport: ModelRoute["transport"];
	endpointKind: ModelRoute["endpointKind"];
	routeSource: ModelRoute["source"];
	defaultTransport: ModelRoute["transport"];
	defaultEndpointKind: ModelRoute["endpointKind"];
	defaultRouteSource: ModelRoute["source"];
	toolCalling: boolean | number | undefined;
	imageInput: boolean | undefined;
	maxInputTokens: number;
	maxOutputTokens: number;
}

function summarizeThinkingMessages(messages: readonly OpenAIChatMessage[]): {
	assistantToolCallCount: number;
	assistantReasoningCount: number;
	assistantToolCallMissingReasoningCount: number;
} {
	let assistantToolCallCount = 0;
	let assistantReasoningCount = 0;
	let assistantToolCallMissingReasoningCount = 0;
	for (const message of messages) {
		if (message.role !== "assistant") {
			continue;
		}
		const hasToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
		const hasReasoning = typeof message.reasoning_content === "string" && message.reasoning_content.length > 0;
		if (hasToolCalls) {
			assistantToolCallCount++;
		}
		if (hasReasoning) {
			assistantReasoningCount++;
		}
		if (hasToolCalls && !hasReasoning) {
			assistantToolCallMissingReasoningCount++;
		}
	}
	return { assistantToolCallCount, assistantReasoningCount, assistantToolCallMissingReasoningCount };
}

function isAnthropicContentBlockArray(content: AnthropicMessage["content"]): content is AnthropicContentBlock[] {
	return Array.isArray(content);
}

function isAnthropicToolUseBlock(block: AnthropicContentBlock): block is AnthropicToolUseBlock {
	return block.type === "tool_use";
}

function isAnthropicThinkingBlock(block: AnthropicContentBlock): block is AnthropicThinkingBlock {
	return block.type === "thinking" && typeof block.thinking === "string" && block.thinking.length > 0;
}

function summarizeAnthropicThinkingMessages(messages: readonly AnthropicMessage[]): {
	assistantToolCallCount: number;
	assistantReasoningCount: number;
	assistantToolCallMissingReasoningCount: number;
} {
	let assistantToolCallCount = 0;
	let assistantReasoningCount = 0;
	let assistantToolCallMissingReasoningCount = 0;
	for (const message of messages) {
		if (message.role !== "assistant" || !isAnthropicContentBlockArray(message.content)) {
			continue;
		}
		const hasToolCalls = message.content.some(isAnthropicToolUseBlock);
		const hasReasoning = message.content.some(isAnthropicThinkingBlock);
		if (hasToolCalls) {
			assistantToolCallCount++;
		}
		if (hasReasoning) {
			assistantReasoningCount++;
		}
		if (hasToolCalls && !hasReasoning) {
			assistantToolCallMissingReasoningCount++;
		}
	}
	return { assistantToolCallCount, assistantReasoningCount, assistantToolCallMissingReasoningCount };
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

function requestBodyHasDisabledThinking(body: Record<string, unknown>): boolean {
	if (body.enable_thinking === false) {
		return true;
	}
	const thinking = body.thinking;
	return (
		typeof thinking === "object" &&
		thinking !== null &&
		!Array.isArray(thinking) &&
		(thinking as Record<string, unknown>).type === "disabled"
	);
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
	private readonly _cacheByKey = new Map<string, ModelCacheEntry>();
	private readonly _lastGoodCacheByKey = new Map<string, ModelCacheEntry>();
	private readonly _modelDiscoveryOperations = new Map<string, ModelDiscoveryOperation>();
	private readonly _modelDiscoveryFailures = new Map<string, ModelDiscoveryFailure>();
	private readonly _modelDiscoveryRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly _modelCredentials = new WeakMap<LanguageModelChatInformation, ModelCredentialBinding>();
	private readonly _providerGroups = new Map<string, ProviderGroupState>();
	private _providerGroupResolutionGeneration = 0;
	private _providerGroupsSeenInResolution = new Set<string>();
	private _providerGroupReconcileTimer: ReturnType<typeof setTimeout> | undefined;
	private _cacheGeneration = 0;

	constructor(
		private readonly userAgent: string,
		private readonly statusBarItem: vscode.StatusBarItem,
		private readonly output: InfiniAILogger
	) {}

	dispose(): void {
		this.cancelAllModelDiscoveries();
		if (this._providerGroupReconcileTimer) {
			clearTimeout(this._providerGroupReconcileTimer);
		}
		this._onDidChange.dispose();
		this._onDidConsumeUsage.dispose();
	}

	getProviderGroupDiagnostics(): readonly ProviderGroupDiagnostic[] {
		return [...this._providerGroups.values()]
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((group) => {
				const cache = this._lastGoodCacheByKey.get(group.cacheKey);
				const failure = this._modelDiscoveryFailures.get(group.cacheKey);
				return {
					name: group.name,
					modelCount: cache?.infos.length ?? 0,
					cacheAgeMs: cache ? Date.now() - cache.fetchedAt : undefined,
					lastError: failure?.error.message,
					retryAt: failure && Number.isFinite(failure.retryAt) ? failure.retryAt : undefined,
				};
			});
	}

	refreshModels(): void {
		this.cancelAllModelDiscoveries();
		this._cacheByKey.clear();
		this._lastGoodCacheByKey.clear();
		this._modelDiscoveryFailures.clear();
		for (const group of this._providerGroups.values()) {
			this._providerGroups.set(group.name, {
				...group,
				cacheKey: this.buildCacheKey(group.apiKey),
			});
		}
		this._cacheGeneration++;
		this._onDidChange.fire();
	}

	notifyModelVisibilityChanged(): void {
		this._onDidChange.fire();
	}

	rebuildCachedModelMetadata(): void {
		this.cancelAllModelDiscoveries();
		this._modelDiscoveryFailures.clear();
		const previousGroups = [...this._providerGroups.values()];
		const previousCaches = new Map(this._lastGoodCacheByKey);
		const rebuiltByKey = new Map<string, ModelCacheEntry>();
		this._cacheByKey.clear();
		this._lastGoodCacheByKey.clear();
		for (const group of previousGroups) {
			const nextKey = this.buildCacheKey(group.apiKey);
			const existing = rebuiltByKey.get(nextKey);
			const previous = previousCaches.get(group.cacheKey);
			const rebuilt = existing ?? (previous ? this.rebuildCacheEntry(previous, nextKey) : undefined);
			if (rebuilt) {
				rebuiltByKey.set(nextKey, rebuilt);
				this._cacheByKey.set(nextKey, rebuilt);
				this._lastGoodCacheByKey.set(nextKey, rebuilt);
			}
			this._providerGroups.set(group.name, { ...group, cacheKey: nextKey });
		}
		this._cacheGeneration++;
		this._onDidChange.fire();
	}

	async provideLanguageModelChatInformation(
		options: vscode.PrepareLanguageModelChatModelOptions,
		_token: CancellationToken
	): Promise<LanguageModelChatInformation[]> {
		const apiKey = readProviderApiKey(options);
		// VS Code resolves every configurable vendor once without a group before
		// resolving configured groups. A groupless result would duplicate models
		// and would not have a credential binding.
		if (!apiKey) {
			this.beginProviderGroupResolution();
			return [];
		}
		const groupName = readProviderGroupName(options) ?? "InfiniAI";
		const key = this.buildCacheKey(apiKey);
		const group = this.registerProviderGroup(groupName, apiKey, key);
		const cached = this._cacheByKey.get(key);
		if (cached && this.isCacheFresh(cached)) {
			return this.filterHiddenModels(this.modelsBoundToGroup(cached.infos, group));
		}

		const lastGood = this._lastGoodCacheByKey.get(key);
		const failure = this.activeDiscoveryFailure(key);
		if (failure && !lastGood) {
			throw failure.error;
		}
		if (!failure) {
			this.ensureBackgroundDiscovery(apiKey, key);
		}
		if (!lastGood) {
			// Never hold VS Code's provider sequencer on network I/O. The
			// background operation fires onDidChange when models or status arrive.
			return [];
		}
		return this.filterHiddenModels(this.modelsBoundToGroup(lastGood.infos, group));
	}

	private modelsBoundToGroup(
		infos: readonly LanguageModelChatInformation[],
		group: ProviderGroupState
	): LanguageModelChatInformation[] {
		return infos.map((info) => {
			// Discovery caches are shared by credentials, but model instances are
			// group-specific. Cloning prevents two provider groups that use the
			// same key from overwriting each other's request/remediation context.
			const bound = { ...info };
			this._modelCredentials.set(bound, group);
			return bound;
		});
	}

	private filterHiddenModels(infos: LanguageModelChatInformation[]): LanguageModelChatInformation[] {
		return infos.filter((info) => !isModelHidden(info.id));
	}

	private activeCredential(binding: ModelCredentialBinding | undefined): ProviderGroupState | undefined {
		if (!binding) {
			return undefined;
		}
		const current = this._providerGroups.get(binding.name);
		return current && current.cacheKey === binding.cacheKey && current.apiKey === binding.apiKey ? current : undefined;
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
		const binding = this._modelCredentials.get(model);

		try {
			await this.applyRequestDelay(token);
			const credential = this.activeCredential(binding);
			if (!credential) {
				throw new Error(
					`InfiniAI model "${model.id}" is no longer bound to a VS Code provider group. Open Manage Models and select the model again.`
				);
			}
			const apiKey = credential.apiKey;

			const cache = await this.getModelCache(apiKey, false, token, false, true);
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
				const message = err instanceof Error ? err.message : String(err);
				logError(this.output, `Chat request failed model=${model.id} error=${sanitizeForLog(message)}`);
				void surfaceActionableError(err, {
					modelId: model.id,
					providerGroup: binding?.name,
				});
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
		if (token.isCancellationRequested) {
			throw new vscode.CancellationError();
		}
		const discoveryUrl = this.getModelDiscoveryUrl();
		const routeCounts = countModelRouteOverrides(
			vscode.workspace.getConfiguration("infiniai").get<unknown>("modelRoutes", [])
		);
		const groups = this.getProviderGroupDiagnostics();
		const caches = this.uniqueProviderGroupCaches();
		const discoveryStats = this.sumDiscoveryStats(caches);
		const cacheAges = caches.map((cache) => Date.now() - cache.fetchedAt);
		const firstFailure = [...this._providerGroups.values()]
			.map((group) => this._modelDiscoveryFailures.get(group.cacheKey))
			.find((failure) => failure !== undefined);
		return {
			vscodeVersion: vscode.version,
			providerGroupCount: groups.length,
			modelCount: groups.reduce((sum, group) => sum + group.modelCount, 0),
			discoveryStats,
			routeConfigCount: routeCounts.routeConfigCount,
			exactModelRouteOverrideCount: routeCounts.exactModelRouteOverrideCount,
			cacheAgeMs: cacheAges.length > 0 ? Math.max(...cacheAges) : undefined,
			modelDiscoveryUrl: discoveryUrl,
			lastError: firstFailure?.error.message,
			groups,
		};
	}

	async getModelDescriptions(refresh: boolean, token: CancellationToken): Promise<InfiniAIModelDescription[]> {
		if (refresh) {
			await this.refreshProviderGroups(token);
		}
		const descriptions: InfiniAIModelDescription[] = [];
		for (const group of [...this._providerGroups.values()].sort((a, b) => a.name.localeCompare(b.name))) {
			const entry = this._lastGoodCacheByKey.get(group.cacheKey);
			if (!entry) {
				continue;
			}
			for (const info of entry.infos) {
				const model = entry.models.find((candidate) => candidate.id === info.id);
				const route =
					entry.routes.get(info.id) ?? resolveModelRoute(this.toModelInfo(info, model), this.getRouteConfigs());
				const defaultRoute = resolveModelRoute(this.toModelInfo(info, model), []);
				descriptions.push({
					id: info.id,
					group: group.name,
					transport: route.transport,
					endpointKind: route.endpointKind,
					routeSource: route.source,
					defaultTransport: defaultRoute.transport,
					defaultEndpointKind: defaultRoute.endpointKind,
					defaultRouteSource: defaultRoute.source,
					toolCalling: info.capabilities.toolCalling,
					imageInput: info.capabilities.imageInput,
					maxInputTokens: info.maxInputTokens,
					maxOutputTokens: info.maxOutputTokens,
				});
			}
		}
		return descriptions;
	}

	async testRoute(prompt: string, token: CancellationToken): Promise<string> {
		const group = await this.pickProviderGroup(token);
		const entry = await this.getModelCache(group.apiKey, false, token);
		const candidates = getVisibleInfiniAITestModels(entry.infos, entry.models, isModelHidden);
		if (candidates.length === 0) {
			throw new Error("No visible InfiniAI chat-capable models are available");
		}
		const selected = await this.pickInfiniAITestModel(entry, candidates, token);
		const model = entry.models.find((m) => m.id === selected.id);
		const route =
			entry.routes.get(selected.id) ?? resolveModelRoute(this.toModelInfo(selected, model), this.getRouteConfigs());
		const body = this.createTestRequestBody(selected.id, prompt || "Reply with OK.", route.transport);
		const response = await this.postJsonWithRetry(
			this.requestUrl(route, selected.id),
			this.requestHeaders(route, group.apiKey),
			body,
			token
		);
		await response.body?.cancel();
		return `OK: ${selected.id} via ${route.transport} in ${group.name} (${response.status})`;
	}

	private async pickInfiniAITestModel(
		entry: ModelCacheEntry,
		candidates: readonly LanguageModelChatInformation[],
		token: CancellationToken
	): Promise<LanguageModelChatInformation> {
		if (candidates.length === 1) {
			return candidates[0];
		}
		const routeConfigs = this.getRouteConfigs();
		const picks = candidates.map<InfiniAITestModelPick>((info) => {
			const model = entry.models.find((candidate) => candidate.id === info.id);
			const route = entry.routes.get(info.id) ?? resolveModelRoute(this.toModelInfo(info, model), routeConfigs);
			return {
				label: info.id,
				description: route.transport,
				detail: `${route.source} - ${route.endpointKind} - ${info.maxInputTokens.toLocaleString()}/${info.maxOutputTokens.toLocaleString()}`,
				info,
			};
		});
		const pick = await vscode.window.showQuickPick(picks, {
			placeHolder: vscode.l10n.t("Select an InfiniAI model to test"),
			matchOnDescription: true,
			matchOnDetail: true,
			ignoreFocusOut: true,
		});
		if (!pick || token.isCancellationRequested) {
			throw new vscode.CancellationError();
		}
		return pick.info;
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
		_silent: boolean,
		token: CancellationToken,
		force = false,
		allowStaleWhileRefreshing = false
	): Promise<ModelCacheEntry> {
		const key = this.buildCacheKey(apiKey);
		if (force) {
			this.cancelModelDiscovery(key);
			this._cacheByKey.delete(key);
			this._modelDiscoveryFailures.delete(key);
		}
		const cached = this._cacheByKey.get(key);
		if (!force && cached && this.isCacheFresh(cached)) {
			return cached;
		}
		const lastGood = this._lastGoodCacheByKey.get(key);
		if (!force && allowStaleWhileRefreshing && lastGood) {
			if (!this.activeDiscoveryFailure(key)) {
				this.ensureBackgroundDiscovery(apiKey, key);
			}
			return lastGood;
		}
		const failure = !force ? this.activeDiscoveryFailure(key) : undefined;
		if (failure) {
			if (lastGood) {
				return lastGood;
			}
			throw failure.error;
		}

		try {
			return await this.waitForDiscovery(this.startModelDiscovery(apiKey, key, force).promise, token);
		} catch (err) {
			if (err instanceof vscode.CancellationError) {
				throw err;
			}
			const fallback = this._lastGoodCacheByKey.get(key);
			if (fallback) {
				logWarn(
					this.output,
					`Model discovery failed; using last-known models: ${sanitizeForLog(
						err instanceof Error ? err.message : String(err)
					)}`
				);
				return fallback;
			}
			throw err;
		}
	}

	private startModelDiscovery(apiKey: string, key: string, force = false): ModelDiscoveryOperation {
		if (force) {
			this.cancelModelDiscovery(key);
			this._cacheByKey.delete(key);
			this._modelDiscoveryFailures.delete(key);
		}
		const existing = this._modelDiscoveryOperations.get(key);
		if (existing) {
			return existing;
		}

		const generation = this._cacheGeneration;
		const cancellation = new vscode.CancellationTokenSource();
		const fetchPromise = this.fetchAndNormalizeModels(apiKey, key, cancellation.token);
		const trackedPromise = fetchPromise
			.then((entry) => {
				if (generation === this._cacheGeneration) {
					const previous = this._lastGoodCacheByKey.get(key);
					const previousFailure = this._modelDiscoveryFailures.delete(key);
					this.clearModelDiscoveryRetry(key);
					this._cacheByKey.set(key, entry);
					this._lastGoodCacheByKey.set(key, entry);
					if (!previous || previous.signature !== entry.signature || previousFailure) {
						this._onDidChange.fire();
					}
				}
				return entry;
			})
			.catch((err) => {
				if (err instanceof vscode.CancellationError) {
					throw err;
				}
				if (generation === this._cacheGeneration) {
					const changed = this.recordDiscoveryFailure(key, err);
					if (changed) {
						this._onDidChange.fire();
					}
				}
				throw err;
			})
			.finally(() => {
				const current = this._modelDiscoveryOperations.get(key);
				if (current?.promise === trackedPromise) {
					this._modelDiscoveryOperations.delete(key);
					cancellation.dispose();
				}
			});
		const operation = { promise: trackedPromise, cancellation };
		this._modelDiscoveryOperations.set(key, operation);
		return operation;
	}

	private ensureBackgroundDiscovery(apiKey: string, key: string): void {
		void this.startModelDiscovery(apiKey, key).promise.catch((err) => {
			if (err instanceof vscode.CancellationError) {
				return;
			}
			logWarn(
				this.output,
				`Background model discovery failed: ${sanitizeForLog(err instanceof Error ? err.message : String(err))}`
			);
		});
	}

	private async fetchAndNormalizeModels(
		apiKey: string,
		key: string,
		token: CancellationToken
	): Promise<ModelCacheEntry> {
		const discovery = await fetchModels(apiKey, this.userAgent, this.output, token);
		return this.createCacheEntry(discovery, key, Date.now());
	}

	private createCacheEntry(
		discovery: NormalizedInfiniAIModelsResponse,
		key: string,
		fetchedAt: number
	): ModelCacheEntry {
		const selection = selectInfiniAIChatModels(discovery.models);
		const routeConfigs = this.getRouteConfigs();
		const routes = new Map<string, ModelRoute>();
		const enrichedModels = selection.models.map(enrichModelWithBuiltInMetadata);
		const infos = enrichedModels.map((model) => {
			const route = resolveModelRoute(model, routeConfigs);
			routes.set(model.id, route);
			return this.toLanguageModelInfo(model, route);
		});
		const discoveryStats: ModelDiscoveryStats = {
			rawModelCount: discovery.rawModelCount,
			chatModelCount: enrichedModels.length,
			nonChatModelCount: selection.nonChatModelCount,
			unknownModelTypeCount: selection.unknownModelTypeCount,
			malformedModelCount: discovery.malformedModelCount,
			duplicateModelCount: discovery.duplicateModelCount,
			liveOutputLimitCount: selection.liveOutputLimitCount,
		};
		logInfo(
			this.output,
			`Discovered ${discoveryStats.rawModelCount} model rows: ${discoveryStats.chatModelCount} chat-eligible, ` +
				`${discoveryStats.nonChatModelCount} non-chat filtered, ${discoveryStats.unknownModelTypeCount} unknown-type filtered, ` +
				`${discoveryStats.malformedModelCount} malformed, ${discoveryStats.duplicateModelCount} duplicate; ` +
				`${discoveryStats.liveOutputLimitCount} live output limits applied`
		);
		if (discoveryStats.unknownModelTypeCount > 0) {
			logWarn(
				this.output,
				`Excluded ${discoveryStats.unknownModelTypeCount} models with unknown or missing model_type values`
			);
		}
		const entry: ModelCacheEntry = {
			key,
			models: enrichedModels,
			infos,
			routes,
			discoveryStats,
			fetchedAt,
			signature: "",
		};
		entry.signature = this.cacheEntrySignature(entry);
		return entry;
	}

	private toLanguageModelInfo(model: InfiniAIModelInfo, route: ModelRoute): LanguageModelChatInformation {
		const contextLength = model.context_length ?? this.inferContextLength(model.id) ?? DEFAULT_CONTEXT_LENGTH;
		const providerMaxOutput = model.max_output_length ?? model.max_tokens ?? model.maxOutputTokens;
		const { maxInputTokens: maxInput, maxOutputTokens: maxOutput } = computeLanguageModelTokenBudget(
			contextLength,
			providerMaxOutput,
			DEFAULT_MAX_TOKENS
		);
		const cfg = vscode.workspace.getConfiguration("infiniai");
		const enablePatterns = cfg.get<string[]>("imageInputModels", []);
		const disablePatterns = cfg.get<string[]>("disableImageInputModels", []);
		const toolEnablePatterns = cfg.get<string[]>("toolCallingModels", []);
		const toolDisablePatterns = cfg.get<string[]>("disableToolCallingModels", []);
		const imageInput = resolveImageInputCapability(
			{
				...model,
				vision: model.vision ?? model.capabilities?.imageInput,
			},
			{ enablePatterns, disablePatterns }
		);
		const toolCalling = resolveToolCallingCapability(model, {
			enablePatterns: toolEnablePatterns,
			verifiedPatterns: VERIFIED_TOOL_CALLING_MODEL_PATTERNS,
			disablePatterns: toolDisablePatterns,
		});
		const translateModelConfiguration = (message: string, ...args: readonly (string | number | boolean)[]): string =>
			vscode.l10n.t(message, ...args);

		const modelConfigSchema = buildInfiniAIModelConfigurationSchema(
			model,
			maxOutput,
			route.transport,
			translateModelConfiguration
		);
		const modelTypeLabel = formatInfiniAIModelType(model.model_type);
		const defaultTooltip = [
			`InfiniAI Model ${model.id}`,
			modelTypeLabel ? `Type: ${modelTypeLabel}` : undefined,
			model.context_length ? `Context: ${model.context_length.toLocaleString("en-US")} tokens` : undefined,
			providerMaxOutput ? `Max output: ${providerMaxOutput.toLocaleString("en-US")} tokens` : undefined,
		].filter((line): line is string => line !== undefined);
		const defaultDetail = ["InfiniAI", modelTypeLabel, route.transport].filter(
			(part): part is string => part !== undefined
		);

		return makeUserSelectableLanguageModelInfo(
			{
				id: model.id,
				name: model.displayName ?? model.id,
				tooltip: appendModelConfigurationSummaryToTooltip(
					model.tooltip ?? defaultTooltip.join("\n"),
					modelConfigSchema,
					translateModelConfiguration
				),
				detail: model.detail ?? defaultDetail.join(" · "),
				family: model.family ?? inferModelFamily(model.id),
				version: resolveInfiniAIModelVersion(model),
				maxInputTokens: maxInput,
				maxOutputTokens: maxOutput,
				capabilities: {
					toolCalling,
					imageInput,
				},
			},
			modelConfigSchema
		);
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
		const converter = new OpenaiApi();
		const openaiMessages = converter.convertMessages(messages, { includeReasoningInRequest: false });
		const disableThinkingPatterns = getDisableThinkingPatterns();
		const roundTripPatterns = getThinkingRoundTripPatterns();
		const modelConfiguration = resolveInfiniAIModelConfiguration(options, {
			maxOutputTokens: model.maxOutputTokens,
		});
		const reasoningProfile = resolveReasoningDialectProfile({
			modelId: model.id,
			transport: route.transport,
		});
		const defaultRequestThinkingMode = getDefaultRequestThinkingMode({
			profile: reasoningProfile,
			configuredThinkingMode: modelConfiguration.thinkingMode,
		});
		const profileDefaultDisablesThinking = defaultRequestThinkingMode === "disabled";
		const userOptedIntoRoundTrip =
			shouldEnableThinkingRoundTrip(model.id, roundTripPatterns) &&
			shouldHonorThinkingRoundTripForProfile({
				profile: reasoningProfile,
				configuredThinkingMode: modelConfiguration.thinkingMode,
			});
		const forceDisableThinking = shouldDisableThinking(model.id, disableThinkingPatterns);
		const effectiveForceDisableThinking = forceDisableThinking || profileDefaultDisablesThinking;
		const replayRequiredByProfile = shouldRequireThinkingReplayByProfile({
			profile: reasoningProfile,
			configuredThinkingMode: modelConfiguration.thinkingMode,
			forceDisableThinking: effectiveForceDisableThinking,
		});
		await thinkingReplayStore.prune();
		const replayPreflight = applyThinkingReplay({
			modelId: model.id,
			profile: reasoningProfile,
			messages: openaiMessages,
			store: thinkingReplayStore,
		});
		const replayCarrier = isStoredReplayCarrier(reasoningProfile.replayCarrier)
			? reasoningProfile.replayCarrier
			: "reasoning_content";
		const allowMissingReplay = reasoningProfile.replayRisk === "reasoning-content-best-effort-after-tool-call";
		const replayDecision = decideThinkingReplayRequest({
			userOptedIntoRoundTrip,
			replayRequiredByProfile,
			allowMissingReplay,
			preflight: replayPreflight,
			failureContext: {
				modelId: model.id,
				transport: route.transport,
				profileId: reasoningProfile.id,
				carrier: replayCarrier,
			},
		});
		if (replayDecision.failLocalReason) {
			logWarn(this.output, sanitizeForLog(replayDecision.failLocalReason, 600));
			throw new Error(replayDecision.failLocalReason);
		}
		const requestMessages = replayDecision.allowThinkingRoundTrip ? replayPreflight.messages : openaiMessages;
		const captureDisabledThinkingObservation = shouldCaptureDisabledThinkingObservation({
			profile: reasoningProfile,
			configuredThinkingMode: modelConfiguration.thinkingMode,
			forceDisableThinking: effectiveForceDisableThinking,
			allowThinkingRoundTrip: replayDecision.allowThinkingRoundTrip,
		});
		const pendingThinkingTurn =
			replayDecision.allowThinkingRoundTrip || captureDisabledThinkingObservation
				? thinkingReplayStore.beginTurn({
						modelId: model.id,
						profileId: reasoningProfile.id,
						transport: reasoningProfile.transport,
						carrier: replayCarrier,
						historyKey:
							reasoningProfile.replayScope === "all-assistant-messages"
								? buildOpenAIReplayHistoryKey(openaiMessages)
								: undefined,
						captureAssistantMessages: reasoningProfile.replayScope === "all-assistant-messages",
						allowsMissingReplayPayload:
							reasoningProfile.allowsMissingReplayPayload || captureDisabledThinkingObservation,
					})
				: undefined;
		const suppressResponseThinking =
			(modelConfiguration.thinkingMode === "disabled" && reasoningProfile.canDisableThinking) ||
			(effectiveForceDisableThinking && !replayDecision.allowThinkingRoundTrip);
		const openaiApi = new OpenaiApi({
			thinkingReplayStore: pendingThinkingTurn ? thinkingReplayStore : undefined,
			pendingThinkingTurn,
			emitThinkingParts: !suppressResponseThinking,
			replayCarrier,
		});
		let requestBody: Record<string, unknown> = {
			model: model.id,
			messages: requestMessages,
			stream: true,
			stream_options: { include_usage: true },
		};
		requestBody = openaiApi.prepareRequestBody(
			requestBody,
			infiniAIModel,
			options,
			replayDecision.allowThinkingRoundTrip,
			model.maxOutputTokens
		);
		if (effectiveForceDisableThinking && !replayDecision.allowThinkingRoundTrip) {
			applyReasoningRequestControls(requestBody, reasoningProfile, { thinkingMode: "disabled" });
		}
		const replayPreservationControls = buildReplayPreservationRequestControls({
			allowThinkingRoundTrip: replayDecision.allowThinkingRoundTrip,
			profile: reasoningProfile,
			configuredThinkingMode: modelConfiguration.thinkingMode,
		});
		if (replayPreservationControls) {
			applyReasoningRequestControls(requestBody, reasoningProfile, replayPreservationControls);
		}
		const thinkingSummary = summarizeThinkingMessages(requestMessages);
		const requestInitiator = (options as { requestInitiator?: unknown }).requestInitiator;
		const thinkingDisabled = requestBodyHasDisabledThinking(requestBody);
		if (thinkingDisabled) {
			const source =
				modelConfiguration.thinkingMode === "disabled"
					? "modelConfiguration"
					: forceDisableThinking
						? "safetyPattern"
						: profileDefaultDisablesThinking
							? "profileDefault"
							: "requestBody";
			logInfo(this.output, `Thinking disabled for request model=${sanitizeForLog(model.id, 120)} source=${source}`);
		}
		logDebug(
			this.output,
			`Thinking guard model=${sanitizeForLog(model.id, 120)} vscode=${sanitizeForLog(vscode.version, 40)} ` +
				`app=${sanitizeForLog(vscode.env.appName, 80)} transport=OpenAI ` +
				`requestInitiator=${sanitizeForLog(String(requestInitiator ?? ""), 120)} ` +
				`hasThinkingPartApi=${hasThinkingPartApi()} ` +
				`reasoningProfile=${sanitizeForLog(reasoningProfile.id, 120)} ` +
				`reasoningDialect=${sanitizeForLog(reasoningProfile.currentTurnControl.kind, 120)} ` +
				`replayCarrier=${sanitizeForLog(reasoningProfile.replayCarrier, 120)} ` +
				`forceDisable=${forceDisableThinking} ` +
				`profileDefaultThinkingMode=${sanitizeForLog(String(defaultRequestThinkingMode ?? ""), 40)} ` +
				`roundTripOptIn=${userOptedIntoRoundTrip} ` +
				`roundTripAllowed=${replayDecision.allowThinkingRoundTrip} ` +
				`roundTripReplayed=${replayPreflight.replayedCount} ` +
				`roundTripMissing=${replayPreflight.missingCallIds.length} ` +
				`roundTripConflicts=${replayPreflight.conflictingCallIds.length} ` +
				`roundTripMissingAssistantMessages=${replayPreflight.missingAssistantMessageIndexes.length} ` +
				`roundTripConflictingAssistantMessages=${replayPreflight.conflictingAssistantMessageIndexes.length} ` +
				`thinkingDisabled=${thinkingDisabled} ` +
				`disablePatterns=${sanitizeForLog(disableThinkingPatterns.join(","), 300)} ` +
				`roundTripPatterns=${sanitizeForLog(roundTripPatterns.join(","), 300)} ` +
				`assistantToolCalls=${thinkingSummary.assistantToolCallCount} ` +
				`assistantReasoning=${thinkingSummary.assistantReasoningCount} ` +
				`assistantToolCallsMissingReasoning=${thinkingSummary.assistantToolCallMissingReasoningCount}`
		);
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
		const converter = new AnthropicApi();
		const anthropicMessages = converter.convertMessages(messages, {
			includeReasoningInRequest: false,
			supportParameters: "",
		});
		const disableThinkingPatterns = getDisableThinkingPatterns();
		const roundTripPatterns = getThinkingRoundTripPatterns();
		const modelConfiguration = resolveInfiniAIModelConfiguration(options, {
			maxOutputTokens: model.maxOutputTokens,
		});
		const reasoningProfile = resolveReasoningDialectProfile({
			modelId: model.id,
			transport: route.transport,
		});
		const defaultRequestThinkingMode = getDefaultRequestThinkingMode({
			profile: reasoningProfile,
			configuredThinkingMode: modelConfiguration.thinkingMode,
		});
		const profileDefaultDisablesThinking = defaultRequestThinkingMode === "disabled";
		const userOptedIntoRoundTrip =
			shouldEnableThinkingRoundTrip(model.id, roundTripPatterns) &&
			shouldHonorThinkingRoundTripForProfile({
				profile: reasoningProfile,
				configuredThinkingMode: modelConfiguration.thinkingMode,
			});
		const forceDisableThinking = shouldDisableThinking(model.id, disableThinkingPatterns);
		const effectiveForceDisableThinking = forceDisableThinking || profileDefaultDisablesThinking;
		const replayRequiredByProfile = shouldRequireThinkingReplayByProfile({
			profile: reasoningProfile,
			configuredThinkingMode: modelConfiguration.thinkingMode,
			forceDisableThinking: effectiveForceDisableThinking,
		});
		await thinkingReplayStore.prune();
		const replayPreflight = applyAnthropicThinkingReplay({
			modelId: model.id,
			profile: reasoningProfile,
			messages: anthropicMessages,
			store: thinkingReplayStore,
		});
		const replayCarrier = isStoredReplayCarrier(reasoningProfile.replayCarrier)
			? reasoningProfile.replayCarrier
			: "anthropic_thinking_block";
		const allowMissingReplay = reasoningProfile.replayRisk === "reasoning-content-best-effort-after-tool-call";
		const replayDecision = decideThinkingReplayRequest({
			userOptedIntoRoundTrip,
			replayRequiredByProfile,
			allowMissingReplay,
			preflight: replayPreflight,
			failureContext: {
				modelId: model.id,
				transport: route.transport,
				profileId: reasoningProfile.id,
				carrier: replayCarrier,
			},
		});
		if (replayDecision.failLocalReason) {
			logWarn(this.output, sanitizeForLog(replayDecision.failLocalReason, 600));
			throw new Error(replayDecision.failLocalReason);
		}
		const requestMessages = replayDecision.allowThinkingRoundTrip ? replayPreflight.messages : anthropicMessages;
		const pendingThinkingTurn = replayDecision.allowThinkingRoundTrip
			? thinkingReplayStore.beginTurn({
					modelId: model.id,
					profileId: reasoningProfile.id,
					transport: reasoningProfile.transport,
					carrier: replayCarrier,
				})
			: undefined;
		const suppressResponseThinking =
			(modelConfiguration.thinkingMode === "disabled" && reasoningProfile.canDisableThinking) ||
			(effectiveForceDisableThinking && !replayDecision.allowThinkingRoundTrip);
		const anthropicApi = new AnthropicApi({
			thinkingReplayStore: pendingThinkingTurn ? thinkingReplayStore : undefined,
			pendingThinkingTurn,
			emitThinkingParts: !suppressResponseThinking,
		});
		let requestBody: AnthropicRequestBody = {
			model: model.id,
			messages: requestMessages,
			stream: true,
			max_tokens: model.maxOutputTokens || DEFAULT_MAX_TOKENS,
		};
		requestBody = anthropicApi.prepareRequestBody(requestBody, infiniAIModel, options, model.maxOutputTokens);
		if (suppressResponseThinking) {
			applyReasoningRequestControls(requestBody as unknown as Record<string, unknown>, reasoningProfile, {
				thinkingMode: "disabled",
			});
		}
		const replayPreservationControls = buildReplayPreservationRequestControls({
			allowThinkingRoundTrip: replayDecision.allowThinkingRoundTrip,
			profile: reasoningProfile,
			configuredThinkingMode: modelConfiguration.thinkingMode,
		});
		if (replayPreservationControls) {
			applyReasoningRequestControls(requestBody as unknown as Record<string, unknown>, reasoningProfile, {
				...replayPreservationControls,
			});
		}
		const thinkingSummary = summarizeAnthropicThinkingMessages(requestMessages);
		const requestInitiator = (options as { requestInitiator?: unknown }).requestInitiator;
		const thinkingDisabled = requestBodyHasDisabledThinking(requestBody as unknown as Record<string, unknown>);
		if (thinkingDisabled) {
			const source =
				modelConfiguration.thinkingMode === "disabled"
					? "modelConfiguration"
					: forceDisableThinking
						? "safetyPattern"
						: profileDefaultDisablesThinking
							? "profileDefault"
							: "requestBody";
			logInfo(this.output, `Thinking disabled for request model=${sanitizeForLog(model.id, 120)} source=${source}`);
		}
		logDebug(
			this.output,
			`Thinking guard model=${sanitizeForLog(model.id, 120)} vscode=${sanitizeForLog(vscode.version, 40)} ` +
				`app=${sanitizeForLog(vscode.env.appName, 80)} transport=Anthropic ` +
				`requestInitiator=${sanitizeForLog(String(requestInitiator ?? ""), 120)} ` +
				`hasThinkingPartApi=${hasThinkingPartApi()} ` +
				`reasoningProfile=${sanitizeForLog(reasoningProfile.id, 120)} ` +
				`reasoningDialect=${sanitizeForLog(reasoningProfile.currentTurnControl.kind, 120)} ` +
				`replayCarrier=${sanitizeForLog(reasoningProfile.replayCarrier, 120)} ` +
				`forceDisable=${forceDisableThinking} ` +
				`profileDefaultThinkingMode=${sanitizeForLog(String(defaultRequestThinkingMode ?? ""), 40)} ` +
				`roundTripOptIn=${userOptedIntoRoundTrip} ` +
				`roundTripAllowed=${replayDecision.allowThinkingRoundTrip} ` +
				`roundTripReplayed=${replayPreflight.replayedCount} ` +
				`roundTripMissing=${replayPreflight.missingCallIds.length} ` +
				`roundTripConflicts=${replayPreflight.conflictingCallIds.length} ` +
				`thinkingDisabled=${thinkingDisabled} ` +
				`disablePatterns=${sanitizeForLog(disableThinkingPatterns.join(","), 300)} ` +
				`roundTripPatterns=${sanitizeForLog(roundTripPatterns.join(","), 300)} ` +
				`assistantToolCalls=${thinkingSummary.assistantToolCallCount} ` +
				`assistantReasoning=${thinkingSummary.assistantReasoningCount} ` +
				`assistantToolCallsMissingReasoning=${thinkingSummary.assistantToolCallMissingReasoningCount}`
		);
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
		requestBody = vertexApi.prepareRequestBody(requestBody, infiniAIModel, options, model.maxOutputTokens);
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
				Authorization: `Bearer ${apiKey}`,
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

	async refreshProviderGroupsWithProgress(): Promise<void> {
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: vscode.l10n.t("InfiniAI: Refreshing available models…"),
				cancellable: true,
			},
			async (_progress, token) => {
				await this.refreshProviderGroups(token);
			}
		);
	}

	private async refreshProviderGroups(token: CancellationToken): Promise<void> {
		const groups = [...this._providerGroups.values()];
		if (groups.length === 0) {
			throw new Error("No InfiniAI provider group is available. Add one in VS Code Manage Models.");
		}
		this.cancelAllModelDiscoveries();
		this._cacheByKey.clear();
		this._modelDiscoveryFailures.clear();
		this._cacheGeneration++;
		const cancellation = token.onCancellationRequested(() => this.cancelAllModelDiscoveries());
		try {
			const uniqueGroups = new Map(groups.map((group) => [group.cacheKey, group]));
			await Promise.all(
				[...uniqueGroups.values()].map((group) =>
					this.waitForDiscovery(this.startModelDiscovery(group.apiKey, group.cacheKey, true).promise, token)
				)
			);
		} finally {
			cancellation.dispose();
		}
	}

	private registerProviderGroup(name: string, apiKey: string, cacheKey: string): ProviderGroupState {
		this._providerGroupsSeenInResolution.add(name);
		const existing = this._providerGroups.get(name);
		if (existing && existing.cacheKey !== cacheKey) {
			const oldKeyStillInUse = [...this._providerGroups.entries()].some(
				([otherName, otherGroup]) => otherName !== name && otherGroup.cacheKey === existing.cacheKey
			);
			if (!oldKeyStillInUse) {
				this.cancelModelDiscovery(existing.cacheKey);
				this._cacheByKey.delete(existing.cacheKey);
				this._lastGoodCacheByKey.delete(existing.cacheKey);
				this._modelDiscoveryFailures.delete(existing.cacheKey);
			}
		}
		const group = { name, apiKey, cacheKey };
		this._providerGroups.set(name, group);
		return group;
	}

	private beginProviderGroupResolution(): void {
		const generation = ++this._providerGroupResolutionGeneration;
		this._providerGroupsSeenInResolution = new Set<string>();
		if (this._providerGroupReconcileTimer) {
			clearTimeout(this._providerGroupReconcileTimer);
		}
		this._providerGroupReconcileTimer = setTimeout(() => {
			this._providerGroupReconcileTimer = undefined;
			if (generation !== this._providerGroupResolutionGeneration) {
				return;
			}
			const removedKeys = new Set<string>();
			for (const [name, group] of this._providerGroups) {
				if (!this._providerGroupsSeenInResolution.has(name)) {
					this._providerGroups.delete(name);
					removedKeys.add(group.cacheKey);
				}
			}
			const retainedKeys = new Set([...this._providerGroups.values()].map((group) => group.cacheKey));
			for (const key of removedKeys) {
				if (retainedKeys.has(key)) {
					continue;
				}
				this.cancelModelDiscovery(key);
				this._cacheByKey.delete(key);
				this._lastGoodCacheByKey.delete(key);
				this._modelDiscoveryFailures.delete(key);
			}
		}, 0);
	}

	private isCacheFresh(entry: ModelCacheEntry): boolean {
		const ttl = this.getCacheTtlMs();
		return ttl > 0 && Date.now() - entry.fetchedAt < ttl;
	}

	private activeDiscoveryFailure(key: string): ModelDiscoveryFailure | undefined {
		const failure = this._modelDiscoveryFailures.get(key);
		return failure && failure.retryAt > Date.now() ? failure : undefined;
	}

	private recordDiscoveryFailure(key: string, err: unknown): boolean {
		const categorized = categorizeError(err);
		const category = categorized?.category ?? "unknown";
		const previous = this._modelDiscoveryFailures.get(key);
		const failureCount = previous?.category === category ? previous.failureCount + 1 : 1;
		const failedAt = Date.now();
		const retryAt = this.discoveryRetryAt(err, category, failureCount, failedAt);
		const error = this.discoveryErrorForUser(err, category);
		const next: ModelDiscoveryFailure = { error, category, failedAt, retryAt, failureCount };
		this._modelDiscoveryFailures.set(key, next);
		this.scheduleModelDiscoveryRetry(key, retryAt);
		logError(
			this.output,
			`Model discovery failed category=${category} retry=${
				Number.isFinite(retryAt) ? `in ${Math.max(0, retryAt - failedAt)}ms` : "after credential change"
			}: ${sanitizeForLog(error.message)}`
		);
		return (
			!previous ||
			previous.category !== next.category ||
			previous.error.message !== next.error.message ||
			previous.retryAt !== next.retryAt
		);
	}

	private discoveryRetryAt(err: unknown, category: ErrorCategory, failureCount: number, failedAt: number): number {
		if (category === "auth") {
			return Number.POSITIVE_INFINITY;
		}
		if (category === "rate-limit" && err instanceof HttpError && err.retryAfterMs !== undefined) {
			return failedAt + Math.max(1000, err.retryAfterMs);
		}
		if (category === "unknown" || category === "model-not-found" || category === "quota") {
			return failedAt + DISCOVERY_PROTOCOL_BACKOFF_MS;
		}
		const exponential = Math.min(
			DISCOVERY_FAILURE_BACKOFF_MAX_MS,
			DISCOVERY_FAILURE_BACKOFF_BASE_MS * 2 ** Math.max(0, failureCount - 1)
		);
		const jittered = Math.max(1000, Math.floor(exponential * (0.9 + Math.random() * 0.2)));
		return failedAt + jittered;
	}

	private discoveryErrorForUser(err: unknown, category: ErrorCategory): Error {
		if (category === "auth") {
			return new Error(
				"InfiniAI rejected this provider-group API key. Open VS Code Manage Models and use Update API Key."
			);
		}
		return err instanceof Error ? err : new Error(String(err));
	}

	private waitForDiscovery<T>(promise: Promise<T>, token: CancellationToken): Promise<T> {
		if (token.isCancellationRequested) {
			return Promise.reject(new vscode.CancellationError());
		}
		return new Promise<T>((resolve, reject) => {
			let cancellation: vscode.Disposable = { dispose: () => undefined };
			cancellation = token.onCancellationRequested(() => {
				cancellation.dispose();
				reject(new vscode.CancellationError());
			});
			promise.then(
				(value) => {
					cancellation.dispose();
					resolve(value);
				},
				(err) => {
					cancellation.dispose();
					reject(err);
				}
			);
		});
	}

	private cancelModelDiscovery(key: string): void {
		this.clearModelDiscoveryRetry(key);
		const operation = this._modelDiscoveryOperations.get(key);
		if (!operation) {
			return;
		}
		this._modelDiscoveryOperations.delete(key);
		operation.cancellation.cancel();
		operation.cancellation.dispose();
	}

	private scheduleModelDiscoveryRetry(key: string, retryAt: number): void {
		this.clearModelDiscoveryRetry(key);
		if (!Number.isFinite(retryAt)) {
			return;
		}
		const timer = setTimeout(
			() => {
				this._modelDiscoveryRetryTimers.delete(key);
				const failure = this._modelDiscoveryFailures.get(key);
				if (!failure) {
					return;
				}
				if (failure.retryAt > Date.now()) {
					this.scheduleModelDiscoveryRetry(key, failure.retryAt);
					return;
				}
				const group = [...this._providerGroups.values()].find((candidate) => candidate.cacheKey === key);
				if (group) {
					this.ensureBackgroundDiscovery(group.apiKey, key);
				}
			},
			Math.max(0, retryAt - Date.now())
		);
		(timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
		this._modelDiscoveryRetryTimers.set(key, timer);
	}

	private clearModelDiscoveryRetry(key: string): void {
		const timer = this._modelDiscoveryRetryTimers.get(key);
		if (timer) {
			clearTimeout(timer);
			this._modelDiscoveryRetryTimers.delete(key);
		}
	}

	private cancelAllModelDiscoveries(): void {
		for (const key of [...this._modelDiscoveryOperations.keys()]) {
			this.cancelModelDiscovery(key);
		}
		for (const key of [...this._modelDiscoveryRetryTimers.keys()]) {
			this.clearModelDiscoveryRetry(key);
		}
	}

	private cacheEntrySignature(entry: ModelCacheEntry): string {
		return JSON.stringify(
			entry.infos.map((info) => ({
				id: info.id,
				name: info.name,
				tooltip: info.tooltip,
				detail: info.detail,
				family: info.family,
				version: info.version,
				maxInputTokens: info.maxInputTokens,
				maxOutputTokens: info.maxOutputTokens,
				capabilities: info.capabilities,
				route: entry.routes.get(info.id),
			}))
		);
	}

	private rebuildCacheEntry(previous: ModelCacheEntry, key: string): ModelCacheEntry {
		const routeConfigs = this.getRouteConfigs();
		const routes = new Map<string, ModelRoute>();
		const infos = previous.models.map((model) => {
			const route = resolveModelRoute(model, routeConfigs);
			routes.set(model.id, route);
			return this.toLanguageModelInfo(model, route);
		});
		const rebuilt: ModelCacheEntry = {
			key,
			models: previous.models,
			infos,
			routes,
			discoveryStats: previous.discoveryStats,
			fetchedAt: previous.fetchedAt,
			signature: "",
		};
		rebuilt.signature = this.cacheEntrySignature(rebuilt);
		return rebuilt;
	}

	private uniqueProviderGroupCaches(): ModelCacheEntry[] {
		const caches = new Map<string, ModelCacheEntry>();
		for (const group of this._providerGroups.values()) {
			const cache = this._lastGoodCacheByKey.get(group.cacheKey);
			if (cache) {
				caches.set(group.cacheKey, cache);
			}
		}
		return [...caches.values()];
	}

	private sumDiscoveryStats(caches: readonly ModelCacheEntry[]): ModelDiscoveryStats | undefined {
		if (caches.length === 0) {
			return undefined;
		}
		const total: ModelDiscoveryStats = {
			rawModelCount: 0,
			chatModelCount: 0,
			nonChatModelCount: 0,
			unknownModelTypeCount: 0,
			malformedModelCount: 0,
			duplicateModelCount: 0,
			liveOutputLimitCount: 0,
		};
		for (const cache of caches) {
			for (const key of Object.keys(total) as (keyof ModelDiscoveryStats)[]) {
				total[key] += cache.discoveryStats[key];
			}
		}
		return total;
	}

	private async pickProviderGroup(token: CancellationToken): Promise<ProviderGroupState> {
		const groups = [...this._providerGroups.values()].sort((a, b) => a.name.localeCompare(b.name));
		if (groups.length === 0) {
			throw new Error("No InfiniAI provider group is available. Add one in VS Code Manage Models.");
		}
		if (groups.length === 1) {
			return groups[0];
		}
		const pick = await vscode.window.showQuickPick(
			groups.map((group) => ({
				label: group.name,
				description: vscode.l10n.t(
					"{0} cached models",
					this._lastGoodCacheByKey.get(group.cacheKey)?.infos.length ?? 0
				),
				group,
			})),
			{
				placeHolder: vscode.l10n.t("Select an InfiniAI provider group"),
				ignoreFocusOut: true,
			}
		);
		if (!pick || token.isCancellationRequested) {
			throw new vscode.CancellationError();
		}
		return pick.group;
	}

	private buildCacheKey(apiKey: string): string {
		const cfg = vscode.workspace.getConfiguration("infiniai");
		const routeConfig = JSON.stringify(cfg.get<ModelRouteConfig[]>("modelRoutes", []));
		const imageConfig = JSON.stringify({
			enable: cfg.get<string[]>("imageInputModels", []),
			disable: cfg.get<string[]>("disableImageInputModels", []),
		});
		const toolConfig = JSON.stringify({
			enable: cfg.get<string[]>("toolCallingModels", []),
			disable: cfg.get<string[]>("disableToolCallingModels", []),
		});
		return [
			this.getModelDiscoveryUrl(),
			hashString(apiKey),
			hashString(routeConfig),
			hashString(imageConfig),
			hashString(toolConfig),
		].join("|");
	}

	private getModelDiscoveryUrl(): string {
		const configured = vscode.workspace.getConfiguration("infiniai").get<string>("modelDiscoveryUrl", "").trim();
		if (configured) {
			return configured;
		}
		return "https://cloud.infini-ai.com/maas/v1/models";
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
		if (modelId.includes("glm-5.2")) return 1000000;
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
