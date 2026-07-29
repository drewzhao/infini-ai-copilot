import * as vscode from "vscode";
import { InfiniAIChatModelProvider } from "./provider";
import { initStatusBar } from "./statusBar";
import { registerInfiniAIChatParticipant } from "./participant";
import { INFINIAI_API_KEY_SECRET_NAME, logInfo, promptForApiKey } from "./utils";
import {
	ApiKeyInputProvider,
	INFINIAI_AUTH_PROVIDER_ID,
	INFINIAI_AUTH_PROVIDER_LABEL,
	InfiniAIAuthenticationProvider,
} from "./auth/infiniaiAuthProvider";
import { registerInfiniAIModelsTreeView } from "./views/modelsView";
import { registerInfiniAIUsageDashboard } from "./views/usageDashboard";
import { registerCopilotChatDependencyCheck } from "./copilotChatDependency";
import { registerInfiniAILanguageStatus } from "./views/languageStatusItem";
import { getThinkingReplayStoreMode } from "./thinkingMode";
import {
	LocalPlaintextThinkingReplayStorage,
	MemoryThinkingReplayStorage,
	thinkingReplayStore,
} from "./thinkingReplayStore";

async function configureThinkingReplayStore(
	context: vscode.ExtensionContext,
	output: vscode.LogOutputChannel
): Promise<void> {
	const mode = getThinkingReplayStoreMode();
	const storageRoot = context.storageUri ?? context.globalStorageUri;
	const storageFile = vscode.Uri.joinPath(storageRoot, "thinking-replay-v1.json");
	if (mode === "memory") {
		await new LocalPlaintextThinkingReplayStorage(storageFile.fsPath).clear();
		await thinkingReplayStore.initialize(new MemoryThinkingReplayStorage());
		logInfo(output, "Thinking replay store initialized mode=memory");
		return;
	}

	await thinkingReplayStore.initialize(new LocalPlaintextThinkingReplayStorage(storageFile.fsPath));
	logInfo(
		output,
		`Thinking replay store initialized mode=localPlaintext entries=${thinkingReplayStore.stats().entryCount}`
	);
}

export async function activate(context: vscode.ExtensionContext) {
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
	await configureThinkingReplayStore(context, output);

	const provider = new InfiniAIChatModelProvider(context.secrets, ua, tokenCountStatusBarItem, output);
	// Register the InfiniAI provider under the vendor id used in package.json
	context.subscriptions.push(
		provider,
		vscode.lm.registerLanguageModelChatProvider("infiniai", provider),
		registerInfiniAIChatParticipant(provider, output),
		registerInfiniAIModelsTreeView(provider, context.secrets, output),
		registerInfiniAIUsageDashboard(context, provider),
		registerCopilotChatDependencyCheck(context),
		registerInfiniAILanguageStatus(provider),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration("infiniai")) {
				provider.refreshModels();
			}
			if (event.affectsConfiguration("infiniai.thinkingReplayStore")) {
				void configureThinkingReplayStore(context, output).catch((err) => {
					logInfo(
						output,
						`Thinking replay store reconfiguration failed: ${err instanceof Error ? err.message : String(err)}`
					);
				});
			}
		}),
		context.secrets.onDidChange((event) => {
			if (event.key === INFINIAI_API_KEY_SECRET_NAME) {
				provider.refreshModels();
			}
		})
	);

	logInfo(output, "InfiniAI Chat Model Provider activated.");

	const apiKeyInputProvider: ApiKeyInputProvider = {
		async promptApiKey(existing) {
			return promptForApiKey(existing);
		},
	};

	const authProvider = new InfiniAIAuthenticationProvider(context.secrets, apiKeyInputProvider);
	context.subscriptions.push(
		authProvider,
		vscode.authentication.registerAuthenticationProvider(
			INFINIAI_AUTH_PROVIDER_ID,
			INFINIAI_AUTH_PROVIDER_LABEL,
			authProvider,
			{ supportsMultipleAccounts: false }
		)
	);

	// Management commands use the same canonical SecretStorage entry surfaced
	// by the AuthenticationProvider.
	context.subscriptions.push(
		vscode.commands.registerCommand("infiniai.setApikey", async () => {
			const session = await authProvider.configureSession();
			if (session) {
				void vscode.window.showInformationMessage(vscode.l10n.t("InfiniAI API key saved."));
			}
		}),
		vscode.commands.registerCommand("infiniai.signOut", async () => {
			const sessions = await authProvider.getSessions();
			if (sessions.length === 0) {
				vscode.window.showInformationMessage(vscode.l10n.t("No InfiniAI accounts are signed in."));
				return;
			}
			const signOut = vscode.l10n.t("Sign Out");
			const confirm = await vscode.window.showWarningMessage(
				vscode.l10n.t("Sign out of InfiniAI and remove the saved API key?"),
				{ modal: true },
				signOut
			);
			if (confirm !== signOut) {
				return;
			}
			await authProvider.removeSession(sessions[0].id);
		}),
		vscode.commands.registerCommand("infiniai.clearThinkingReplayCache", async () => {
			await thinkingReplayStore.clear();
			vscode.window.showInformationMessage(vscode.l10n.t("InfiniAI thinking replay cache cleared."));
		})
	);
}

export function deactivate() {}
