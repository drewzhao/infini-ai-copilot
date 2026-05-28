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

export type ReasoningEffort = ReasoningEffortLevel;
export type ThinkingMode = "enabled" | "disabled";

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
	return value === "low" || value === "medium" || value === "high" ? value : undefined;
}

function normalizeThinkingMode(value: unknown): ThinkingMode | undefined {
	return value === "enabled" || value === "disabled" ? value : undefined;
}

function normalizeMaxOutputTokens(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return undefined;
	}
	const normalized = Math.floor(value);
	return normalized > 0 ? normalized : undefined;
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

function getReasoningEffortDescription(control: ReasoningEffortControl): string {
	switch (control) {
		case "openai-reasoning-effort":
			return "Selected values send reasoning_effort on OpenAI-compatible routes. Unset sends nothing.";
		case "anthropic-output-config-effort":
			return "Selected values send output_config.effort on Anthropic Messages routes. Unset sends nothing.";
		case "none":
			return "";
	}
}

function getReasoningEffortEnumDescriptions(control: ReasoningEffortControl): string[] {
	const parameterName = control === "anthropic-output-config-effort" ? "output_config.effort" : "reasoning_effort";
	return [
		`Do not send ${parameterName}.`,
		`Send ${parameterName}=low.`,
		`Send ${parameterName}=medium.`,
		`Send ${parameterName}=high.`,
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
	options: ProvideLanguageModelChatResponseOptions
): InfiniAIModelConfiguration {
	const raw = readRawModelConfiguration(options);
	const resolved: InfiniAIModelConfiguration = {
		maxOutputTokens: normalizeMaxOutputTokens(raw.maxOutputTokens),
		reasoningEffort: normalizeReasoningEffort(raw.reasoningEffort),
		thinkingMode: normalizeThinkingMode(raw.thinkingMode),
	};
	return Object.fromEntries(Object.entries(resolved).filter(([, value]) => value !== undefined));
}

export function buildInfiniAIModelConfigurationSchema(
	model: InfiniAIModelInfo,
	maxOutputTokens: number,
	transport: ModelTransport = "openai"
): InfiniAIModelConfigurationSchema {
	const profile = resolveReasoningDialectProfile({ modelId: model.id, transport });
	const outputChoices = getMaxOutputTokenChoices(maxOutputTokens);
	const outputLabels = outputChoices.map((value) => (value === 0 ? "Model default" : formatTokenLabel(value)));
	const properties: Record<string, InfiniAIModelConfigurationPropertySchema> = {
		maxOutputTokens: {
			type: "number",
			title: "Max output tokens",
			description: "Caps the number of tokens the model may produce for a response.",
			enum: outputChoices,
			enumItemLabels: outputLabels,
			default: 0,
			group: "tokens",
			minimum: 0,
			maximum: Math.max(1, Math.floor(maxOutputTokens)),
		},
	};
	if (profile.reasoningEffortControl !== "none") {
		properties.reasoningEffort = {
			type: "string",
			title: "Reasoning effort",
			description: getReasoningEffortDescription(profile.reasoningEffortControl),
			enum: ["unset", "low", "medium", "high"],
			enumItemLabels: ["Unset", "Low", "Medium", "High"],
			enumDescriptions: getReasoningEffortEnumDescriptions(profile.reasoningEffortControl),
			default: "unset",
			group: "navigation",
		};
	}

	const thinkingModes: string[] = ["unset"];
	const thinkingLabels: string[] = ["Unset"];
	const thinkingDescriptions: string[] = ["Use the provider default for this model profile."];
	if (profile.canDisableThinking) {
		thinkingModes.push("disabled");
		thinkingLabels.push("Disabled");
		thinkingDescriptions.push("Send the disable-thinking control supported by this model profile.");
	}
	if (profile.canEnableThinking) {
		thinkingModes.push("enabled");
		thinkingLabels.push("Enabled");
		thinkingDescriptions.push("Send the enable-thinking control supported by this model profile.");
	}
	if (thinkingModes.length > 1) {
		properties.thinkingMode = {
			type: "string",
			title: "Thinking mode",
			description: "Controls thinking only for model profiles with a confirmed request parameter.",
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
	schema: InfiniAIModelConfigurationSchema
): string {
	const labels = getConfigurableControlLabels(schema);
	if (labels.length === 0) {
		return tooltip;
	}
	const summary = `Configurable: ${labels.join(", ")}`;
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
	const shouldSendEffort =
		resolvedProfile.reasoningEffortControl === "openai-reasoning-effort" &&
		configuration.thinkingMode !== "disabled";
	const reasoningEffort =
		configuration.reasoningEffort ??
		(configuration.thinkingMode === "enabled" || options.useDefaultReasoningEffort
			? resolvedProfile.defaultReasoningEffort
			: undefined);
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
		configuration.reasoningEffort !== undefined
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
