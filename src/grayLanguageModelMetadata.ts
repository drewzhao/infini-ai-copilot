import type * as vscode from "vscode";

export interface StableSafeGrayLanguageModelMetadata {
	readonly isUserSelectable?: boolean;
	readonly statusIcon?: vscode.ThemeIcon;
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
	};
}

export function makeUserSelectableLanguageModelInfo(
	info: vscode.LanguageModelChatInformation
): InfiniAILanguageModelChatInformation {
	return withStableSafeGrayLanguageModelMetadata(info, { isUserSelectable: true });
}
