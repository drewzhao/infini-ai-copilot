import * as vscode from "vscode";

const COPILOT_CHAT_ID = "github.copilot-chat";
const SUPPRESS_KEY = "infiniai.copilotChat.installPrompt.suppressed";

interface ChatPromptState {
	lastShown?: number;
}

/**
 * Watch for the github.copilot-chat extension and surface a one-time install
 * prompt if it is missing, since the InfiniAI provider needs Copilot Chat to
 * render any UI.
 */
export function registerCopilotChatDependencyCheck(context: vscode.ExtensionContext): vscode.Disposable {
	const disposables: vscode.Disposable[] = [];
	let warningShown = false;

	const evaluate = async () => {
		const ext = vscode.extensions.getExtension(COPILOT_CHAT_ID);
		if (ext) {
			warningShown = false;
			return;
		}
		if (warningShown) {
			return;
		}
		const suppressed = context.globalState.get<ChatPromptState>(SUPPRESS_KEY);
		const cooldownMs = 7 * 24 * 60 * 60 * 1000;
		if (suppressed?.lastShown && Date.now() - suppressed.lastShown < cooldownMs) {
			return;
		}
		warningShown = true;
		const install = vscode.l10n.t("Install Copilot Chat");
		const remind = vscode.l10n.t("Remind Me Later");
		const choice = await vscode.window.showInformationMessage(
			vscode.l10n.t(
				"GitHub Copilot Chat is required to use InfiniAI models. Install it to start chatting."
			),
			install,
			remind
		);
		if (choice === install) {
			await vscode.commands.executeCommand("workbench.extensions.installExtension", COPILOT_CHAT_ID);
		} else {
			await context.globalState.update(SUPPRESS_KEY, { lastShown: Date.now() } satisfies ChatPromptState);
		}
	};

	disposables.push(
		vscode.extensions.onDidChange(() => {
			void evaluate();
		})
	);

	// Run once after activation so we don't block the extension host.
	const handle = setTimeout(() => {
		void evaluate();
	}, 1500);
	disposables.push({ dispose: () => clearTimeout(handle) });

	return vscode.Disposable.from(...disposables);
}
