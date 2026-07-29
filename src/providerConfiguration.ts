import type { PrepareLanguageModelChatModelOptions } from "vscode";

type ProviderConfigurationOptions = PrepareLanguageModelChatModelOptions & {
	readonly configuration?: unknown;
};

export function hasProviderConfiguration(options: PrepareLanguageModelChatModelOptions): boolean {
	return (options as ProviderConfigurationOptions).configuration !== undefined;
}

export function readProviderApiKey(options: PrepareLanguageModelChatModelOptions): string | undefined {
	const configuration = (options as ProviderConfigurationOptions).configuration;
	if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) {
		return undefined;
	}
	const apiKey = (configuration as Record<string, unknown>).apiKey;
	return typeof apiKey === "string" && apiKey.trim().length > 0 ? apiKey.trim() : undefined;
}
