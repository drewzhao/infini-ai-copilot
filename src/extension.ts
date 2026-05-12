import * as vscode from "vscode";
import { InfiniAIChatModelProvider } from "./provider";
import { initStatusBar } from "./statusBar";
import { registerInfiniAIChatParticipant } from "./participant";
import { logInfo } from "./utils";

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

	// Management command to configure API key (with plan picker)
	context.subscriptions.push(
		vscode.commands.registerCommand("infiniai.setApikey", async () => {
			// Ask which plan's API key to configure
			const planChoice = await vscode.window.showQuickPick(
				[
					{ label: vscode.l10n.t("Standard Plan"), description: vscode.l10n.t("Pay-per-token billing"), plan: "standard" },
					{ label: vscode.l10n.t("Coding Plan"), description: vscode.l10n.t("Coding Plan subscription"), plan: "coding" },
				],
				{
					title: vscode.l10n.t("InfiniAI: Select Plan"),
					placeHolder: vscode.l10n.t("Which plan's API key do you want to configure?"),
				}
			);
			if (!planChoice) {
				return; // user canceled
			}

			const secretKey = planChoice.plan === "coding" ? "infiniai.codingApiKey" : "infiniai.apiKey";
			const planLabel = planChoice.label;

			// Update the plan setting to match the user's choice
			const config = vscode.workspace.getConfiguration("infiniai");
			if (config.get<string>("plan") !== planChoice.plan) {
				await config.update("plan", planChoice.plan, vscode.ConfigurationTarget.Global);
			}

			const existing = await context.secrets.get(secretKey);
			const apiKey = await vscode.window.showInputBox({
				title: vscode.l10n.t("InfiniAI {0} API Key", planLabel),
				prompt: existing
					? vscode.l10n.t("Update your {0} API key", planLabel)
					: vscode.l10n.t("Enter your {0} API key", planLabel),
				ignoreFocusOut: true,
				password: true,
				value: existing ?? "",
			});
			if (apiKey === undefined) {
				return; // user canceled
			}
			if (!apiKey.trim()) {
				await context.secrets.delete(secretKey);
				provider.refreshModels();
				vscode.window.showInformationMessage(vscode.l10n.t("InfiniAI {0} API key cleared.", planLabel));
				return;
			}
			await context.secrets.store(secretKey, apiKey.trim());
			provider.refreshModels();
			vscode.window.showInformationMessage(vscode.l10n.t("InfiniAI {0} API key saved.", planLabel));
		})
	);
}

export function deactivate() {}
