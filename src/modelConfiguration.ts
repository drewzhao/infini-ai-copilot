import type { ProvideLanguageModelChatResponseOptions } from "vscode";

import {
	resolveReasoningDialectProfile,
	type ReasoningDialectProfile,
	type ReasoningEffortControl,
	type ReasoningEffortLevel,
} from "./reasoningDialect";
import { applyReasoningRequestControls } from "./reasoningRequest";
import type { InfiniAIModelInfo, ModelTransport } from "./types";

type ModelConfigurationRecord = Record<string, unknown>;
type TranslationArgument = string | number | boolean;
export type ModelConfigurationTranslate = (message: string, ...args: readonly TranslationArgument[]) => string;

export type ReasoningEffort = ReasoningEffortLevel;
export type ThinkingMode = "enabled" | "disabled";
const DEFAULT_REASONING_EFFORT_LEVELS: readonly ReasoningEffort[] = ["low", "medium", "high"];

export interface InfiniAIModelConfiguration {
	readonly maxOutputTokens?: number;
	readonly reasoningEffort?: ReasoningEffort;
	readonly thinkingMode?: ThinkingMode;
}

export interface InfiniAIModelConfigurationPropertySchema {
	readonly type: "string" | "number";
	readonly title: string;
	readonly description?: string;
	readonly enum?: readonly unknown[];
	readonly enumItemLabels?: readonly string[];
	readonly enumDescriptions?: readonly string[];
	readonly default?: unknown;
	readonly group?: string;
	readonly minimum?: number;
	readonly maximum?: number;
}

export interface InfiniAIModelConfigurationSchema {
	readonly properties: Record<string, InfiniAIModelConfigurationPropertySchema>;
}

export interface ApplyOpenAIModelConfigurationOptions {
	readonly useDefaultReasoningEffort?: boolean;
}

export interface InfiniAIModelConfigurationConstraints {
	readonly maxOutputTokens?: number;
}

function defaultTranslate(message: string, ...args: readonly TranslationArgument[]): string {
	return message.replace(/\{(\d+)\}/g, (match, index: string) => {
		const value = args[Number(index)];
		return value === undefined ? match : String(value);
	});
}

function getConfigurableControlLabels(schema: InfiniAIModelConfigurationSchema): string[] {
	return Object.values(schema.properties)
		.filter((property) => Array.isArray(property.enum) && property.enum.length >= 2)
		.map((property) => property.title ?? property.description)
		.filter((label): label is string => typeof label === "string" && label.length > 0);
}

function isRecord(value: unknown): value is ModelConfigurationRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeReasoningEffort(value: unknown): ReasoningEffort | undefined {
	return value === "low" || value === "medium" || value === "high" || value === "max" ? value : undefined;
}

function normalizeThinkingMode(value: unknown): ThinkingMode | undefined {
	return value === "enabled" || value === "disabled" ? value : undefined;
}

function normalizeMaxOutputTokens(value: unknown, maximum?: number): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return undefined;
	}
	const normalized = Math.floor(value);
	if (normalized <= 0) {
		return undefined;
	}
	if (maximum !== undefined) {
		const normalizedMaximum = Math.floor(maximum);
		if (!Number.isFinite(normalizedMaximum) || normalizedMaximum <= 0 || normalized > normalizedMaximum) {
			return undefined;
		}
	}
	return normalized;
}

function uniqueNumbers(values: readonly number[]): number[] {
	return [...new Set(values)];
}

function formatTokenLabel(value: number): string {
	if (value >= 1024 && value % 1024 === 0) {
		return `${value / 1024}K`;
	}
	return value.toLocaleString("en-US");
}

function getMaxOutputTokenChoices(maxOutputTokens: number): number[] {
	const bounded = Math.max(1, Math.floor(maxOutputTokens));
	return uniqueNumbers([0, 1024, 4096, 8192, 16384, bounded].filter((value) => value === 0 || value <= bounded));
}

function getReasoningEffortParameterName(control: ReasoningEffortControl): string {
	return control === "anthropic-output-config-effort" ? "output_config.effort" : "reasoning_effort";
}

function getReasoningEffortDescription(
	profile: ReasoningDialectProfile,
	translate: ModelConfigurationTranslate
): string {
	const parameterName = getReasoningEffortParameterName(profile.reasoningEffortControl);
	const selectedDescription =
		profile.reasoningEffortControl === "anthropic-output-config-effort"
			? translate("Selected values send output_config.effort on Anthropic Messages routes.")
			: translate("Selected values send reasoning_effort on OpenAI-compatible routes.");
	const automaticDescription = profile.defaultReasoningEffort
		? translate(
				"Automatic may send {0}={1} when thinking is explicitly enabled or replay safety requires the profile default.",
				parameterName,
				profile.defaultReasoningEffort
			)
		: translate("Automatic does not send {0}.", parameterName);
	const disabledDescription = profile.canDisableThinking
		? ` ${translate("Reasoning effort is ignored while thinking is disabled.")}`
		: "";
	return `${selectedDescription} ${automaticDescription}${disabledDescription}`;
}

function getAutomaticReasoningEffortDescription(
	profile: ReasoningDialectProfile,
	translate: ModelConfigurationTranslate
): string {
	const parameterName = getReasoningEffortParameterName(profile.reasoningEffortControl);
	if (profile.defaultReasoningEffort) {
		return translate(
			"Use automatic profile behavior; explicitly enabled or replay-safe thinking may send {0}={1}.",
			parameterName,
			profile.defaultReasoningEffort
		);
	}
	return translate("Do not send {0}.", parameterName);
}

function getThinkingAutomaticDescription(
	profile: ReasoningDialectProfile,
	translate: ModelConfigurationTranslate
): string {
	if (profile.defaultRequestThinkingMode === "disabled") {
		return translate(
			"Use the profile safety default, which disables thinking unless Enabled is explicitly selected and supported."
		);
	}
	return translate(
		"Use automatic provider and profile behavior, including any required safety or replay-preservation controls."
	);
}

function getReasoningEffortLevels(profile: ReasoningDialectProfile): readonly ReasoningEffort[] {
	return profile.reasoningEffortLevels && profile.reasoningEffortLevels.length > 0
		? profile.reasoningEffortLevels
		: DEFAULT_REASONING_EFFORT_LEVELS;
}

function isSupportedReasoningEffort(profile: ReasoningDialectProfile, effort: ReasoningEffort): boolean {
	return getReasoningEffortLevels(profile).includes(effort);
}

function formatReasoningEffortLabel(effort: ReasoningEffort): string {
	return effort.charAt(0).toUpperCase() + effort.slice(1);
}

function getReasoningEffortEnumDescriptions(
	profile: ReasoningDialectProfile,
	levels: readonly ReasoningEffort[],
	translate: ModelConfigurationTranslate
): string[] {
	const parameterName = getReasoningEffortParameterName(profile.reasoningEffortControl);
	const selectedSuffix = profile.canDisableThinking
		? translate("This setting is ignored while thinking is disabled.")
		: "";
	return [
		getAutomaticReasoningEffortDescription(profile, translate),
		...levels.map(
			(level) => `${translate("Send {0}={1}.", parameterName, level)}${selectedSuffix ? ` ${selectedSuffix}` : ""}`
		),
	];
}

function readRawModelConfiguration(options: ProvideLanguageModelChatResponseOptions): ModelConfigurationRecord {
	const hiddenOptions = options as ProvideLanguageModelChatResponseOptions & {
		readonly configuration?: unknown;
		readonly modelConfiguration?: unknown;
	};
	const configuration = isRecord(hiddenOptions.configuration) ? hiddenOptions.configuration : {};
	const modelConfiguration = isRecord(hiddenOptions.modelConfiguration) ? hiddenOptions.modelConfiguration : {};
	return {
		...configuration,
		...modelConfiguration,
	};
}

export function resolveInfiniAIModelConfiguration(
	options: ProvideLanguageModelChatResponseOptions,
	constraints: InfiniAIModelConfigurationConstraints = {}
): InfiniAIModelConfiguration {
	const raw = readRawModelConfiguration(options);
	const resolved: InfiniAIModelConfiguration = {
		maxOutputTokens: normalizeMaxOutputTokens(raw.maxOutputTokens, constraints.maxOutputTokens),
		reasoningEffort: normalizeReasoningEffort(raw.reasoningEffort),
		thinkingMode: normalizeThinkingMode(raw.thinkingMode),
	};
	return Object.fromEntries(Object.entries(resolved).filter(([, value]) => value !== undefined));
}

export function buildInfiniAIModelConfigurationSchema(
	model: InfiniAIModelInfo,
	maxOutputTokens: number,
	transport: ModelTransport = "openai",
	translate: ModelConfigurationTranslate = defaultTranslate
): InfiniAIModelConfigurationSchema {
	const profile = resolveReasoningDialectProfile({ modelId: model.id, transport });
	const outputChoices = getMaxOutputTokenChoices(maxOutputTokens);
	const outputLabels = outputChoices.map((value) =>
		value === 0 ? translate("Model default") : formatTokenLabel(value)
	);
	const properties: Record<string, InfiniAIModelConfigurationPropertySchema> = {
		maxOutputTokens: {
			type: "number",
			title: translate("Max output tokens"),
			description: translate("Caps the number of tokens the model may produce for a response."),
			enum: outputChoices,
			enumItemLabels: outputLabels,
			default: 0,
			minimum: 0,
			maximum: Math.max(1, Math.floor(maxOutputTokens)),
		},
	};
	if (profile.reasoningEffortControl !== "none") {
		const effortLevels = getReasoningEffortLevels(profile);
		properties.reasoningEffort = {
			type: "string",
			title: translate("Reasoning effort"),
			description: getReasoningEffortDescription(profile, translate),
			enum: ["unset", ...effortLevels],
			enumItemLabels: [
				translate("Automatic"),
				...effortLevels.map((effort) => translate(formatReasoningEffortLabel(effort))),
			],
			enumDescriptions: getReasoningEffortEnumDescriptions(profile, effortLevels, translate),
			default: "unset",
			group: "navigation",
		};
	}

	const thinkingModes: string[] = ["unset"];
	const thinkingLabels: string[] = [translate("Automatic")];
	const thinkingDescriptions: string[] = [getThinkingAutomaticDescription(profile, translate)];
	if (profile.canDisableThinking) {
		thinkingModes.push("disabled");
		thinkingLabels.push(translate("Disabled"));
		thinkingDescriptions.push(translate("Send the disable-thinking control supported by this model profile."));
	}
	if (profile.canEnableThinking) {
		thinkingModes.push("enabled");
		thinkingLabels.push(translate("Enabled"));
		thinkingDescriptions.push(translate("Send the enable-thinking control supported by this model profile."));
	}
	if (thinkingModes.length > 1) {
		properties.thinkingMode = {
			type: "string",
			title: translate("Thinking mode"),
			description: translate("Controls thinking only for model profiles with a confirmed request parameter."),
			enum: thinkingModes,
			enumItemLabels: thinkingLabels,
			enumDescriptions: thinkingDescriptions,
			default: "unset",
		};
	}

	return { properties };
}

export function appendModelConfigurationSummaryToTooltip(
	tooltip: string,
	schema: InfiniAIModelConfigurationSchema,
	translate: ModelConfigurationTranslate = defaultTranslate
): string {
	const labels = getConfigurableControlLabels(schema);
	if (labels.length === 0) {
		return tooltip;
	}
	const summary = translate("Configurable in Manage Models: {0}", labels.join(", "));
	if (tooltip.includes(summary)) {
		return tooltip;
	}
	return tooltip ? `${tooltip}\n\n${summary}` : summary;
}

export function applyOpenAIModelConfiguration(
	body: Record<string, unknown>,
	configuration: InfiniAIModelConfiguration,
	profile?: ReasoningDialectProfile,
	options: ApplyOpenAIModelConfigurationOptions = {}
): void {
	if (configuration.maxOutputTokens !== undefined) {
		body.max_tokens = configuration.maxOutputTokens;
	}
	const resolvedProfile =
		profile ??
		resolveReasoningDialectProfile({
			modelId: typeof body.model === "string" ? body.model : "",
			transport: "openai",
		});
	const thinkingIsDisabled = configuration.thinkingMode === "disabled" && resolvedProfile.canDisableThinking;
	const shouldSendEffort = resolvedProfile.reasoningEffortControl === "openai-reasoning-effort" && !thinkingIsDisabled;
	const configuredEffort =
		configuration.reasoningEffort && isSupportedReasoningEffort(resolvedProfile, configuration.reasoningEffort)
			? configuration.reasoningEffort
			: undefined;
	const defaultEffort =
		resolvedProfile.defaultReasoningEffort &&
		isSupportedReasoningEffort(resolvedProfile, resolvedProfile.defaultReasoningEffort)
			? resolvedProfile.defaultReasoningEffort
			: undefined;
	const reasoningEffort =
		configuredEffort ??
		(configuration.thinkingMode === "enabled" || options.useDefaultReasoningEffort ? defaultEffort : undefined);
	if (shouldSendEffort && reasoningEffort !== undefined) {
		body.reasoning_effort = reasoningEffort;
	}
	applyReasoningRequestControls(body, resolvedProfile, configuration);
}

export function applyAnthropicModelConfiguration(
	body: Record<string, unknown>,
	configuration: InfiniAIModelConfiguration,
	modelOrProfile?: string | ReasoningDialectProfile
): void {
	if (configuration.maxOutputTokens !== undefined) {
		body.max_tokens = configuration.maxOutputTokens;
	}
	const resolvedProfile =
		typeof modelOrProfile === "object" && modelOrProfile !== null
			? modelOrProfile
			: resolveReasoningDialectProfile({
					modelId: modelOrProfile ?? (typeof body.model === "string" ? body.model : ""),
					transport: "anthropic",
				});
	if (
		resolvedProfile.reasoningEffortControl === "anthropic-output-config-effort" &&
		configuration.thinkingMode !== "disabled" &&
		configuration.reasoningEffort !== undefined &&
		isSupportedReasoningEffort(resolvedProfile, configuration.reasoningEffort)
	) {
		const existing = isRecord(body.output_config) ? body.output_config : {};
		body.output_config = {
			...existing,
			effort: configuration.reasoningEffort,
		};
	}
	if (configuration.thinkingMode === "disabled") {
		delete body.output_config;
	}
}

export function applyVertexModelConfiguration(
	body: { generationConfig?: { maxOutputTokens?: number } },
	configuration: InfiniAIModelConfiguration
): void {
	if (configuration.maxOutputTokens === undefined) {
		return;
	}
	body.generationConfig = {
		...body.generationConfig,
		maxOutputTokens: configuration.maxOutputTokens,
	};
}
