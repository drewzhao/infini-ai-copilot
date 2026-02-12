import * as vscode from "vscode";
import { InfiniAIChatModelProvider } from "./provider";
import { initStatusBar } from "./statusBar";

export function activate(context: vscode.ExtensionContext) {
	// Build a descriptive User-Agent to help quantify API usage
	const ext = vscode.extensions.getExtension("drewzhao.infiniai-copilot");
	const extVersion = ext?.packageJSON?.version ?? "unknown";
	const vscodeVersion = vscode.version;
	// Keep UA minimal: only extension version and VS Code version
	const ua = `infiniai-copilot/${extVersion} VSCode/${vscodeVersion}`;

	const tokenCountStatusBarItem: vscode.StatusBarItem = initStatusBar(context);
	// Create an output channel for logging and add it to subscriptions so it is disposed with the extension
	const output = vscode.window.createOutputChannel("InfiniAI");
	context.subscriptions.push(output);

	const provider = new InfiniAIChatModelProvider(context.secrets, ua, tokenCountStatusBarItem, output);
	// Register the InfiniAI provider under the vendor id used in package.json
	vscode.lm.registerLanguageModelChatProvider("infiniai", provider);

	output.appendLine("InfiniAI Chat Model Provider activated.");

	// Management command to configure API key (with plan picker)
	context.subscriptions.push(
		vscode.commands.registerCommand("infiniai.setApikey", async () => {
			// Ask which plan's API key to configure
			const planChoice = await vscode.window.showQuickPick(
				[
					{ label: "Standard Plan", description: "Pay-per-token billing", plan: "standard" },
					{ label: "Coding Plan", description: "Coding Plan subscription", plan: "coding" },
				],
				{ title: "InfiniAI: Select Plan", placeHolder: "Which plan's API key do you want to configure?" }
			);
			if (!planChoice) {
				return; // user canceled
			}

			const secretKey = planChoice.plan === "coding" ? "infiniai.codingApiKey" : "infiniai.apiKey";
			const planLabel = planChoice.label;

			const existing = await context.secrets.get(secretKey);
			const apiKey = await vscode.window.showInputBox({
				title: `InfiniAI ${planLabel} API Key`,
				prompt: existing ? `Update your ${planLabel} API key` : `Enter your ${planLabel} API key`,
				ignoreFocusOut: true,
				password: true,
				value: existing ?? "",
			});
			if (apiKey === undefined) {
				return; // user canceled
			}
			if (!apiKey.trim()) {
				await context.secrets.delete(secretKey);
				vscode.window.showInformationMessage(`InfiniAI ${planLabel} API key cleared.`);
				return;
			}
			await context.secrets.store(secretKey, apiKey.trim());
			vscode.window.showInformationMessage(`InfiniAI ${planLabel} API key saved.`);
		})
	);
}

export function deactivate() {}
