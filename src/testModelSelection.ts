import type { LanguageModelChatInformation } from "vscode";

import type { InfiniAIModelInfo } from "./types";

export function getVisibleInfiniAITestModels(
	infos: readonly LanguageModelChatInformation[],
	models: readonly InfiniAIModelInfo[],
	isHidden: (modelId: string) => boolean
): LanguageModelChatInformation[] {
	const infiniAIModelIds = new Set(models.map((model) => model.id));
	return infos.filter((info) => infiniAIModelIds.has(info.id) && !isHidden(info.id));
}
