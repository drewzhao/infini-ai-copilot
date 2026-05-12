import * as vscode from "vscode";

import { InfiniAIPlan } from "../utils";

interface PlanQuickPickItem extends vscode.QuickPickItem {
	readonly plan?: InfiniAIPlan;
}

const SETTINGS_BUTTON: vscode.QuickInputButton = {
	iconPath: new vscode.ThemeIcon("gear"),
	tooltip: vscode.l10n.t("Configure InfiniAI Settings"),
};

/**
 * Show a multi-step plan picker built on createQuickPick.
 * - Separators group "Plans" and "Other actions".
 * - The currently active plan is marked with a check icon.
 * - Per-item gear button opens the matching settings scope.
 */
export async function pickPlan(currentPlan: InfiniAIPlan | undefined): Promise<InfiniAIPlan | undefined> {
	const qp = vscode.window.createQuickPick<PlanQuickPickItem>();
	qp.title = vscode.l10n.t("InfiniAI: Select Plan");
	qp.placeholder = vscode.l10n.t("Which plan's API key do you want to configure?");
	qp.ignoreFocusOut = true;
	qp.matchOnDescription = true;

	const buildItems = (): PlanQuickPickItem[] => [
		{ label: vscode.l10n.t("Plans"), kind: vscode.QuickPickItemKind.Separator },
		{
			label: `${currentPlan === "standard" ? "$(check) " : ""}${vscode.l10n.t("Standard Plan")}`,
			description: vscode.l10n.t("Pay-per-token billing"),
			plan: "standard",
			buttons: [SETTINGS_BUTTON],
		},
		{
			label: `${currentPlan === "coding" ? "$(check) " : ""}${vscode.l10n.t("Coding Plan")}`,
			description: vscode.l10n.t("Coding Plan subscription"),
			plan: "coding",
			buttons: [SETTINGS_BUTTON],
		},
	];
	qp.items = buildItems();

	try {
		return await new Promise<InfiniAIPlan | undefined>((resolve) => {
			const disposables: vscode.Disposable[] = [];
			disposables.push(
				qp.onDidAccept(() => {
					const selected = qp.selectedItems[0];
					resolve(selected?.plan);
					qp.hide();
				}),
				qp.onDidHide(() => {
					for (const d of disposables) {
						d.dispose();
					}
					resolve(undefined);
				}),
				qp.onDidTriggerItemButton((event) => {
					if (event.button === SETTINGS_BUTTON) {
						void vscode.commands.executeCommand("workbench.action.openSettings", "infiniai");
						resolve(undefined);
						qp.hide();
					}
				})
			);
			qp.show();
		});
	} finally {
		qp.dispose();
	}
}

interface SignOutQuickPickItem extends vscode.QuickPickItem {
	readonly sessionId?: string;
}

/** Pick an account to sign out, using createQuickPick for richer controls. */
export async function pickAccountToSignOut(
	sessions: readonly { id: string; account: { label: string } }[]
): Promise<string | undefined> {
	const qp = vscode.window.createQuickPick<SignOutQuickPickItem>();
	qp.title = vscode.l10n.t("InfiniAI: Sign Out");
	qp.placeholder = vscode.l10n.t("Choose an account to sign out.");
	qp.ignoreFocusOut = true;
	qp.items = [
		{ label: vscode.l10n.t("Accounts"), kind: vscode.QuickPickItemKind.Separator },
		...sessions.map<SignOutQuickPickItem>((s) => ({
			label: s.account.label,
			iconPath: new vscode.ThemeIcon("key"),
			sessionId: s.id,
		})),
	];

	try {
		return await new Promise<string | undefined>((resolve) => {
			const disposables: vscode.Disposable[] = [];
			disposables.push(
				qp.onDidAccept(() => {
					resolve(qp.selectedItems[0]?.sessionId);
					qp.hide();
				}),
				qp.onDidHide(() => {
					for (const d of disposables) {
						d.dispose();
					}
					resolve(undefined);
				})
			);
			qp.show();
		});
	} finally {
		qp.dispose();
	}
}
