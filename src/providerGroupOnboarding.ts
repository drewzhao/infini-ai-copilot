import * as vscode from "vscode";

export const ADD_PROVIDER_GROUP_COMMAND = "infiniai.addProviderGroup";
export const OPEN_MANAGE_MODELS_COMMAND = "infiniai.openManageModels";

export async function showAddProviderGroupGuide(): Promise<void> {
	const openLanguageModels = vscode.l10n.t("Open Language Models");
	const choice = await vscode.window.showInformationMessage(
		vscode.l10n.t("Add an InfiniAI provider group"),
		{
			modal: true,
			detail: vscode.l10n.t(
				'After Language Models opens, select Add Models > InfiniAI. VS Code then asks for Group Name before it asks for the API key.\n\nGroup Name is a local VS Code label. It is not sent to InfiniAI.\n\n- One API key: keep "InfiniAI".\n- Multiple API keys: use a name such as "Work" or "Personal".\n- Do not paste the API key into Group Name.\n\nOn the following API Key prompt, enter the InfiniAI API key. VS Code stores it securely for that group.'
			),
		},
		openLanguageModels
	);
	if (choice !== openLanguageModels) {
		return;
	}
	await vscode.commands.executeCommand(OPEN_MANAGE_MODELS_COMMAND);
}
