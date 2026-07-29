import type * as vscode from "vscode";

import type { InfiniAIModelConfigurationSchema } from "./modelConfiguration";

export interface StableSafeGrayLanguageModelMetadata {
	readonly isBYOK?: boolean;
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
		...(metadata.isBYOK !== undefined ? { isBYOK: metadata.isBYOK } : {}),
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
		// The 1.130 Agents bridge enumerates isBYOK models and assumes they can
		// call tools, so export only models whose tool capability is confirmed.
		isBYOK: !!info.capabilities.toolCalling,
		isUserSelectable: true,
		...(modelConfigSchema !== undefined ? { configurationSchema: modelConfigSchema } : {}),
	});
}
