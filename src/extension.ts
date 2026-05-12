import * as vscode from "vscode";
import { InfiniAIChatModelProvider } from "./provider";
import { initStatusBar } from "./statusBar";
import { registerInfiniAIChatParticipant } from "./participant";
import { logInfo } from "./utils";
import {
	INFINIAI_AUTH_PROVIDER_ID,
	INFINIAI_AUTH_PROVIDER_LABEL,
	InfiniAIAuthenticationProvider,
	PlanInputProvider,
} from "./auth/infiniaiAuthProvider";
import type { InfiniAIPlan } from "./utils";
import { registerInfiniAIModelsTreeView } from "./views/modelsView";
import { registerInfiniAIUsageDashboard } from "./views/usageDashboard";

export function activate(context: vscode.ExtensionContext) {
	// Build a descriptive User-Agent to help quantify API usage
	const ext = vscode.extensions.getExtension("drewzhao.infiniai-copilot");
	const extVersion = ext?.packageJSON?.version ?? "unknown";
	const vscodeVersion = vscode.version;
	// Keep UA minimal: only extension version and VS Code version
	const ua = `infiniai-copilot/${extVersion} VSCode/${vscodeVersion}`;

	const tokenCountStatusBarItem: vscode.StatusBarItem = initStatusBar(context);
	// Create an output channel for logging and add it to subscriptions so it is disposed with the extension
	const output = vscode.window.createOutputChannel("InfiniAI", { log: true });
	context.subscriptions.push(output);

	const provider = new InfiniAIChatModelProvider(context.secrets, ua, tokenCountStatusBarItem, output);
	// Register the InfiniAI provider under the vendor id used in package.json
	context.subscriptions.push(
		provider,
		vscode.lm.registerLanguageModelChatProvider("infiniai", provider),
		registerInfiniAIChatParticipant(provider, output),
		registerInfiniAIModelsTreeView(provider, context.secrets, output),
		registerInfiniAIUsageDashboard(context, provider),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration("infiniai")) {
				provider.refreshModels();
			}
		}),
		context.secrets.onDidChange((event) => {
			if (event.key === "infiniai.apiKey" || event.key === "infiniai.codingApiKey") {
				provider.refreshModels();
			}
		})
	);

	logInfo(output, "InfiniAI Chat Model Provider activated.");

	const planInputProvider: PlanInputProvider = {
		async promptPlan() {
			const choice = await vscode.window.showQuickPick(
				[
					{ label: vscode.l10n.t("Standard Plan"), description: vscode.l10n.t("Pay-per-token billing"), plan: "standard" as InfiniAIPlan },
					{ label: vscode.l10n.t("Coding Plan"), description: vscode.l10n.t("Coding Plan subscription"), plan: "coding" as InfiniAIPlan },
				],
				{
					title: vscode.l10n.t("InfiniAI: Select Plan"),
					placeHolder: vscode.l10n.t("Which plan's API key do you want to configure?"),
				}
			);
			return choice?.plan;
		},
		async promptApiKey(plan, existing) {
			const planLabel = plan === "coding" ? vscode.l10n.t("Coding Plan") : vscode.l10n.t("Standard Plan");
			const entered = await vscode.window.showInputBox({
				title: vscode.l10n.t("InfiniAI {0} API Key", planLabel),
				prompt: existing
					? vscode.l10n.t("Update your {0} API key", planLabel)
					: vscode.l10n.t("Enter your {0} API key", planLabel),
				ignoreFocusOut: true,
				password: true,
				value: existing ?? "",
			});
			return entered?.trim() ? entered.trim() : undefined;
		},
	};

	const authProvider = new InfiniAIAuthenticationProvider(context.secrets, planInputProvider);
	context.subscriptions.push(
		authProvider,
		vscode.authentication.registerAuthenticationProvider(
			INFINIAI_AUTH_PROVIDER_ID,
			INFINIAI_AUTH_PROVIDER_LABEL,
			authProvider,
			{ supportsMultipleAccounts: true }
		)
	);

	// Management command to configure API key (with plan picker). Thin wrapper
	// over the AuthenticationProvider so the Accounts menu and the command
	// share the same persistence path.
	context.subscriptions.push(
		vscode.commands.registerCommand("infiniai.setApikey", async () => {
			const plan = await planInputProvider.promptPlan(undefined);
			if (!plan) {
				return;
			}
			const config = vscode.workspace.getConfiguration("infiniai");
			if (config.get<string>("plan") !== plan) {
				await config.update("plan", plan, vscode.ConfigurationTarget.Global);
			}
			const planLabel = plan === "coding" ? vscode.l10n.t("Coding Plan") : vscode.l10n.t("Standard Plan");
			try {
				await vscode.authentication.getSession(INFINIAI_AUTH_PROVIDER_ID, [plan], { createIfNone: true });
				vscode.window.showInformationMessage(vscode.l10n.t("InfiniAI {0} API key saved.", planLabel));
			} catch {
				// User canceled, nothing to do.
			}
		}),
		vscode.commands.registerCommand("infiniai.signOut", async () => {
			const sessions = await authProvider.getSessions();
			if (sessions.length === 0) {
				vscode.window.showInformationMessage(vscode.l10n.t("No InfiniAI accounts are signed in."));
				return;
			}
			const choice = await vscode.window.showQuickPick(
				sessions.map((s) => ({ label: s.account.label, sessionId: s.id })),
				{ title: vscode.l10n.t("InfiniAI: Sign Out"), placeHolder: vscode.l10n.t("Choose an account to sign out.") }
			);
			if (!choice) {
				return;
			}
			await authProvider.removeSession(choice.sessionId);
		})
	);
}

export function deactivate() {}
