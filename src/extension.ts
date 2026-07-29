import * as vscode from "vscode";
import { InfiniAIChatModelProvider } from "./provider";
import { initStatusBar } from "./statusBar";
import { registerInfiniAIChatParticipant } from "./participant";
import { logInfo } from "./utils";
import { registerInfiniAIModelsTreeView } from "./views/modelsView";
import { registerInfiniAIUsageDashboard } from "./views/usageDashboard";
import { registerInfiniAILanguageStatus } from "./views/languageStatusItem";
import { getThinkingReplayStoreMode } from "./thinkingMode";
import {
	LocalPlaintextThinkingReplayStorage,
	MemoryThinkingReplayStorage,
	thinkingReplayStore,
} from "./thinkingReplayStore";

const DISCOVERY_CONFIGURATION_KEYS = ["infiniai.modelDiscoveryUrl", "infiniai.modelDiscoveryTimeoutMs"] as const;

const MODEL_METADATA_CONFIGURATION_KEYS = [
	"infiniai.baseUrl",
	"infiniai.anthropic.baseUrl",
	"infiniai.modelRoutes",
	"infiniai.imageInputModels",
	"infiniai.disableImageInputModels",
	"infiniai.toolCallingModels",
	"infiniai.disableToolCallingModels",
] as const;

const MODEL_VISIBILITY_CONFIGURATION_KEYS = [
	"infiniai.hiddenModels",
	"infiniai.hiddenModelPatterns",
	"infiniai.visibleModels",
] as const;

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

	const provider = new InfiniAIChatModelProvider(ua, tokenCountStatusBarItem, output);
	// Register the InfiniAI provider under the vendor id used in package.json
	context.subscriptions.push(
		provider,
		vscode.lm.registerLanguageModelChatProvider("infiniai", provider),
		registerInfiniAIChatParticipant(provider, output),
		registerInfiniAIModelsTreeView(provider, output),
		registerInfiniAIUsageDashboard(context, provider),
		registerInfiniAILanguageStatus(provider),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (DISCOVERY_CONFIGURATION_KEYS.some((key) => event.affectsConfiguration(key))) {
				provider.refreshModels();
			} else if (MODEL_METADATA_CONFIGURATION_KEYS.some((key) => event.affectsConfiguration(key))) {
				provider.rebuildCachedModelMetadata();
			} else if (MODEL_VISIBILITY_CONFIGURATION_KEYS.some((key) => event.affectsConfiguration(key))) {
				provider.notifyModelVisibilityChanged();
			}
			if (event.affectsConfiguration("infiniai.thinkingReplayStore")) {
				void configureThinkingReplayStore(context, output).catch((err) => {
					logInfo(
						output,
						`Thinking replay store reconfiguration failed: ${err instanceof Error ? err.message : String(err)}`
					);
				});
			}
		})
	);

	logInfo(output, "InfiniAI Chat Model Provider activated.");

	context.subscriptions.push(
		vscode.commands.registerCommand("infiniai.clearThinkingReplayCache", async () => {
			await thinkingReplayStore.clear();
			vscode.window.showInformationMessage(vscode.l10n.t("InfiniAI thinking replay cache cleared."));
		})
	);
}

export function deactivate() {}
