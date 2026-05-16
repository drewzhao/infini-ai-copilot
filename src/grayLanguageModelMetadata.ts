import type * as vscode from "vscode";

import type { InfiniAIModelConfigurationSchema } from "./modelConfiguration";

export interface StableSafeGrayLanguageModelMetadata {
	readonly isUserSelectable?: boolean;
	readonly statusIcon?: vscode.ThemeIcon;
	readonly configurationSchema?: InfiniAIModelConfigurationSchema;
}

export type InfiniAILanguageModelChatInformation = vscode.LanguageModelChatInformation &
	StableSafeGrayLanguageModelMetadata;

export function withStableSafeGrayLanguageModelMetadata(
	info: vscode.LanguageModelChatInformation,
	metadata: StableSafeGrayLanguageModelMetadata
): InfiniAILanguageModelChatInformation {
	return {
		...info,
		...(metadata.isUserSelectable !== undefined ? { isUserSelectable: metadata.isUserSelectable } : {}),
		...(metadata.statusIcon !== undefined ? { statusIcon: metadata.statusIcon } : {}),
		...(metadata.configurationSchema !== undefined ? { configurationSchema: metadata.configurationSchema } : {}),
	};
}

export function makeUserSelectableLanguageModelInfo(
	info: vscode.LanguageModelChatInformation,
	modelConfigSchema?: InfiniAIModelConfigurationSchema
): InfiniAILanguageModelChatInformation {
	return withStableSafeGrayLanguageModelMetadata(info, {
		isUserSelectable: true,
		...(modelConfigSchema !== undefined ? { configurationSchema: modelConfigSchema } : {}),
	});
}
