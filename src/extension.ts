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

	// Management command to configure API key
	context.subscriptions.push(
		vscode.commands.registerCommand("infiniai.setApikey", async () => {
			const existing = await context.secrets.get("infiniai.apiKey");
			const apiKey = await vscode.window.showInputBox({
				title: "InfiniAI Provider API Key",
				prompt: existing ? "Update your InfiniAI API key" : "Enter your InfiniAI API key",
				ignoreFocusOut: true,
				password: true,
				value: existing ?? "",
			});
			if (apiKey === undefined) {
				return; // user canceled
			}
			if (!apiKey.trim()) {
				await context.secrets.delete("infiniai.apiKey");
				vscode.window.showInformationMessage("InfiniAI API key cleared.");
				return;
			}
			await context.secrets.store("infiniai.apiKey", apiKey.trim());
			vscode.window.showInformationMessage("InfiniAI API key saved.");
		})
	);
}

export function deactivate() {}
