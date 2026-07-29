import type { PrepareLanguageModelChatModelOptions } from "vscode";

type ProviderConfigurationOptions = PrepareLanguageModelChatModelOptions & {
	readonly configuration?: unknown;
	readonly group?: unknown;
};

export function readProviderApiKey(options: PrepareLanguageModelChatModelOptions): string | undefined {
	const configuration = (options as ProviderConfigurationOptions).configuration;
	if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) {
		return undefined;
	}
	const apiKey = (configuration as Record<string, unknown>).apiKey;
	return typeof apiKey === "string" && apiKey.trim().length > 0 ? apiKey.trim() : undefined;
}

export function readProviderGroupName(options: PrepareLanguageModelChatModelOptions): string | undefined {
	const group = (options as ProviderConfigurationOptions).group;
	return typeof group === "string" && group.trim().length > 0 ? group.trim() : undefined;
}
