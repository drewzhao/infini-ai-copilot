import * as vscode from "vscode";

import { ChatUsageEvent, InfiniAIChatModelProvider } from "../provider";

const SELECTOR: vscode.DocumentSelector = [
	{ scheme: "file" },
	{ scheme: "untitled" },
	{ scheme: "vscode-notebook-cell" },
];

interface ModelMeta {
	readonly maxInputTokens: number;
	readonly maxOutputTokens: number;
}

/**
 * A LanguageStatusItem that surfaces the most recently used InfiniAI model and
 * its token-window utilization. Only renders for code documents.
 */
export function registerInfiniAILanguageStatus(
	provider: InfiniAIChatModelProvider
): vscode.Disposable {
	const item = vscode.languages.createLanguageStatusItem("infiniai.model", SELECTOR);
	item.name = vscode.l10n.t("InfiniAI Model");
	item.text = "$(rocket) InfiniAI";
	item.detail = vscode.l10n.t("No requests yet");
	item.command = {
		command: "workbench.action.openSettings",
		title: vscode.l10n.t("Open InfiniAI Settings"),
		arguments: ["infiniai"],
	};

	let lastUsage: ChatUsageEvent | undefined;
	const modelMeta = new Map<string, ModelMeta>();
	let metaLoadInFlight: Promise<void> | undefined;

	const refreshMeta = async (): Promise<void> => {
		if (metaLoadInFlight) {
			return metaLoadInFlight;
		}
		const cancel = new vscode.CancellationTokenSource();
		metaLoadInFlight = (async () => {
			try {
				const descriptions = await provider.getModelDescriptions(false, cancel.token);
				modelMeta.clear();
				for (const m of descriptions) {
					modelMeta.set(m.id, {
						maxInputTokens: m.maxInputTokens,
						maxOutputTokens: m.maxOutputTokens,
					});
				}
			} catch {
				// Silent — fallback to whatever cache we already have.
			} finally {
				cancel.dispose();
				metaLoadInFlight = undefined;
			}
		})();
		return metaLoadInFlight;
	};

	const render = (): void => {
		if (!lastUsage) {
			item.text = "$(rocket) InfiniAI";
			item.detail = vscode.l10n.t("No requests yet");
			item.severity = vscode.LanguageStatusSeverity.Information;
			return;
		}
		const used = lastUsage.inputTokens + lastUsage.outputTokens;
		const meta = modelMeta.get(lastUsage.modelId);
		const max = meta ? meta.maxInputTokens + meta.maxOutputTokens : undefined;
		const usagePct = max ? Math.min(100, Math.round((used / max) * 100)) : undefined;
		const usedText = used.toLocaleString();
		const maxText = max ? max.toLocaleString() : "—";
		item.text = `$(rocket) ${lastUsage.modelId}`;
		item.detail = vscode.l10n.t("{0} / {1} tokens ({2})", usedText, maxText, lastUsage.transport);
		if (usagePct !== undefined && usagePct >= 90) {
			item.severity = vscode.LanguageStatusSeverity.Warning;
		} else {
			item.severity = vscode.LanguageStatusSeverity.Information;
		}
	};

	const disposables: vscode.Disposable[] = [
		item,
		provider.onDidConsumeUsage(async (event) => {
			lastUsage = event;
			if (!modelMeta.has(event.modelId)) {
				await refreshMeta();
			}
			render();
		}),
		provider.onDidChangeLanguageModelChatInformation(() => {
			void refreshMeta().then(render);
		}),
	];

	void refreshMeta().then(render);
	render();

	return vscode.Disposable.from(...disposables);
}
