import * as vscode from "vscode";

import { DEFAULT_HIDDEN_MODEL_PATTERNS, isModelHiddenByVisibilityConfig } from "./modelVisibilityCore";

export { DEFAULT_HIDDEN_MODEL_PATTERNS, isModelHiddenByVisibilityConfig };

export function getHiddenModelIds(): Set<string> {
	return new Set(vscode.workspace.getConfiguration("infiniai").get<string[]>("hiddenModels", []));
}

export function getVisibleModelIds(): Set<string> {
	return new Set(vscode.workspace.getConfiguration("infiniai").get<string[]>("visibleModels", []));
}

export function getHiddenModelPatterns(): string[] {
	return vscode.workspace.getConfiguration("infiniai").get<string[]>("hiddenModelPatterns", [...DEFAULT_HIDDEN_MODEL_PATTERNS]);
}

export function isModelHidden(modelId: string): boolean {
	return isModelHiddenByVisibilityConfig(modelId, getHiddenModelIds(), getVisibleModelIds(), getHiddenModelPatterns());
}

export async function updateHiddenModelIds(hiddenModelIds: readonly string[]): Promise<void> {
	await vscode.workspace
		.getConfiguration("infiniai")
		.update("hiddenModels", [...hiddenModelIds].sort(), vscode.ConfigurationTarget.Global);
}

export async function updateVisibleModelIds(visibleModelIds: readonly string[]): Promise<void> {
	await vscode.workspace
		.getConfiguration("infiniai")
		.update("visibleModels", [...visibleModelIds].sort(), vscode.ConfigurationTarget.Global);
}

export async function showAllProviderModels(): Promise<void> {
	const config = vscode.workspace.getConfiguration("infiniai");
	await config.update("hiddenModels", [], vscode.ConfigurationTarget.Global);
	await config.update("hiddenModelPatterns", [], vscode.ConfigurationTarget.Global);
	await config.update("visibleModels", [], vscode.ConfigurationTarget.Global);
}
