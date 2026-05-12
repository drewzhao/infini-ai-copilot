import * as vscode from "vscode";

import { InfiniAIChatModelProvider } from "../provider";
import { getActivePlan, InfiniAIPlan, logDebug, sanitizeForLog } from "../utils";

interface PlanNode {
	readonly kind: "plan";
}

interface ModelsRootNode {
	readonly kind: "models-root";
}

interface ModelNode {
	readonly kind: "model";
	readonly id: string;
	readonly transport: string;
	readonly toolCalling: boolean;
	readonly imageInput: boolean;
	readonly maxInputTokens: number;
	readonly maxOutputTokens: number;
}

interface AccountRootNode {
	readonly kind: "account-root";
}

interface AccountNode {
	readonly kind: "account";
	readonly plan: InfiniAIPlan;
	readonly fingerprint: string;
}

interface AccountActionNode {
	readonly kind: "account-action";
	readonly label: string;
	readonly tooltip: string;
	readonly command: vscode.Command;
}

interface UsageNode {
	readonly kind: "usage";
}

interface MessageNode {
	readonly kind: "message";
	readonly label: string;
	readonly tooltip?: string;
}

type InfiniNode =
	| PlanNode
	| ModelsRootNode
	| ModelNode
	| AccountRootNode
	| AccountNode
	| AccountActionNode
	| UsageNode
	| MessageNode;

function fingerprint(key: string | undefined): string {
	if (!key) {
		return vscode.l10n.t("not configured");
	}
	const tail = key.length >= 4 ? key.slice(-4) : key;
	return `\u2026${tail}`;
}

export class InfiniAIModelsTreeProvider implements vscode.TreeDataProvider<InfiniNode>, vscode.Disposable {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<InfiniNode | undefined>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private readonly _disposables: vscode.Disposable[] = [];

	constructor(
		private readonly provider: InfiniAIChatModelProvider,
		private readonly secrets: vscode.SecretStorage,
		private readonly output?: vscode.OutputChannel | vscode.LogOutputChannel
	) {
		this._disposables.push(
			provider.onDidChangeLanguageModelChatInformation(() => this._onDidChangeTreeData.fire(undefined)),
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration("infiniai")) {
					this._onDidChangeTreeData.fire(undefined);
				}
			}),
			secrets.onDidChange((event) => {
				if (event.key === "infiniai.apiKey" || event.key === "infiniai.codingApiKey") {
					this._onDidChangeTreeData.fire(undefined);
				}
			})
		);
	}

	dispose(): void {
		for (const d of this._disposables) {
			d.dispose();
		}
		this._onDidChangeTreeData.dispose();
	}

	refresh(): void {
		this._onDidChangeTreeData.fire(undefined);
	}

	getTreeItem(node: InfiniNode): vscode.TreeItem {
		switch (node.kind) {
			case "plan": {
				const plan = getActivePlan();
				const label = plan === "coding" ? vscode.l10n.t("Coding Plan") : vscode.l10n.t("Standard Plan");
				const item = new vscode.TreeItem(
					vscode.l10n.t("Plan: {0}", label),
					vscode.TreeItemCollapsibleState.None
				);
				item.iconPath = new vscode.ThemeIcon("rocket");
				item.contextValue = "infiniai.plan";
				item.tooltip = vscode.l10n.t("Click to switch plan");
				item.command = {
					command: "infiniai.switchPlan",
					title: vscode.l10n.t("Switch Plan"),
				};
				return item;
			}
			case "models-root": {
				const item = new vscode.TreeItem(vscode.l10n.t("Models"), vscode.TreeItemCollapsibleState.Expanded);
				item.iconPath = new vscode.ThemeIcon("server");
				item.contextValue = "infiniai.models";
				return item;
			}
			case "model": {
				const item = new vscode.TreeItem(node.id, vscode.TreeItemCollapsibleState.None);
				item.description = `${node.transport} \u00b7 ${node.maxInputTokens.toLocaleString()}/${node.maxOutputTokens.toLocaleString()}`;
				const lines = [
					vscode.l10n.t("Route: {0}", node.transport),
					vscode.l10n.t("Tools: {0}", node.toolCalling ? vscode.l10n.t("yes") : vscode.l10n.t("no")),
					vscode.l10n.t("Images: {0}", node.imageInput ? vscode.l10n.t("yes") : vscode.l10n.t("no")),
					vscode.l10n.t("Max input tokens: {0}", node.maxInputTokens.toLocaleString()),
					vscode.l10n.t("Max output tokens: {0}", node.maxOutputTokens.toLocaleString()),
				];
				item.tooltip = new vscode.MarkdownString(lines.map((l) => `- ${l}`).join("\n"));
				item.iconPath = new vscode.ThemeIcon(node.imageInput ? "device-camera" : "symbol-method");
				item.contextValue = "infiniai.model";
				return item;
			}
			case "account-root": {
				const item = new vscode.TreeItem(vscode.l10n.t("Account"), vscode.TreeItemCollapsibleState.Expanded);
				item.iconPath = new vscode.ThemeIcon("account");
				item.contextValue = "infiniai.account";
				return item;
			}
			case "account": {
				const planLabel = node.plan === "coding" ? vscode.l10n.t("Coding Plan") : vscode.l10n.t("Standard Plan");
				const item = new vscode.TreeItem(planLabel, vscode.TreeItemCollapsibleState.None);
				item.description = node.fingerprint;
				item.iconPath = new vscode.ThemeIcon("key");
				item.contextValue = "infiniai.accountKey";
				item.tooltip = vscode.l10n.t("API key fingerprint: {0}", node.fingerprint);
				return item;
			}
			case "account-action": {
				const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
				item.iconPath = new vscode.ThemeIcon("link-external");
				item.tooltip = node.tooltip;
				item.command = node.command;
				return item;
			}
			case "usage": {
				const item = new vscode.TreeItem(vscode.l10n.t("Usage (Coming soon)"), vscode.TreeItemCollapsibleState.None);
				item.iconPath = new vscode.ThemeIcon("graph");
				item.tooltip = vscode.l10n.t(
					"Account-wide usage will appear here once the InfiniAI usage / billing API is available."
				);
				item.contextValue = "infiniai.usagePlaceholder";
				return item;
			}
			case "message": {
				const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
				item.iconPath = new vscode.ThemeIcon("info");
				if (node.tooltip) {
					item.tooltip = node.tooltip;
				}
				return item;
			}
		}
	}

	async getChildren(node?: InfiniNode): Promise<InfiniNode[]> {
		if (!node) {
			return [
				{ kind: "plan" },
				{ kind: "models-root" },
				{ kind: "account-root" },
				{ kind: "usage" },
			];
		}
		switch (node.kind) {
			case "models-root":
				return this.getModelChildren();
			case "account-root":
				return this.getAccountChildren();
			default:
				return [];
		}
	}

	private async getModelChildren(): Promise<InfiniNode[]> {
		try {
			const cancel = new vscode.CancellationTokenSource();
			try {
				const models = await this.provider.getModelDescriptions(false, cancel.token);
				if (models.length === 0) {
					return [
						{
							kind: "message",
							label: vscode.l10n.t("No models available. Run \"InfiniAI: Set InfiniAI API Key\"."),
						},
					];
				}
				return models.map<ModelNode>((m) => ({
					kind: "model",
					id: m.id,
					transport: m.transport,
					toolCalling: !!m.toolCalling,
					imageInput: !!m.imageInput,
					maxInputTokens: m.maxInputTokens,
					maxOutputTokens: m.maxOutputTokens,
				}));
			} finally {
				cancel.dispose();
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logDebug(this.output, `Models tree fetch failed: ${sanitizeForLog(message)}`);
			return [
				{
					kind: "message",
					label: vscode.l10n.t("Failed to load models"),
					tooltip: message,
				},
			];
		}
	}

	private async getAccountChildren(): Promise<InfiniNode[]> {
		const standardKey = await this.secrets.get("infiniai.apiKey");
		const codingKey = await this.secrets.get("infiniai.codingApiKey");
		const children: InfiniNode[] = [
			{ kind: "account", plan: "standard", fingerprint: fingerprint(standardKey) },
			{ kind: "account", plan: "coding", fingerprint: fingerprint(codingKey) },
			{
				kind: "account-action",
				label: vscode.l10n.t("Manage Keys\u2026"),
				tooltip: vscode.l10n.t("Open the InfiniAI API key configuration flow."),
				command: { command: "infiniai.setApikey", title: vscode.l10n.t("Set InfiniAI API Key") },
			},
			{
				kind: "account-action",
				label: vscode.l10n.t("Open Dashboard"),
				tooltip: vscode.l10n.t("Open the InfiniAI dashboard in a browser."),
				command: {
					command: "vscode.open",
					title: vscode.l10n.t("Open Dashboard"),
					arguments: [vscode.Uri.parse("https://cloud.infini-ai.com")],
				},
			},
		];
		return children;
	}
}

export function registerInfiniAIModelsTreeView(
	provider: InfiniAIChatModelProvider,
	secrets: vscode.SecretStorage,
	output?: vscode.OutputChannel | vscode.LogOutputChannel
): vscode.Disposable {
	const treeDataProvider = new InfiniAIModelsTreeProvider(provider, secrets, output);
	const view = vscode.window.createTreeView("infiniai.modelsView", {
		treeDataProvider,
		showCollapseAll: true,
	});
	const disposables: vscode.Disposable[] = [
		treeDataProvider,
		view,
		vscode.commands.registerCommand("infiniai.refreshModels", () => {
			provider.refreshModels();
			treeDataProvider.refresh();
		}),
		vscode.commands.registerCommand("infiniai.switchPlan", async () => {
			const current = getActivePlan();
			const next: InfiniAIPlan = current === "coding" ? "standard" : "coding";
			const label = next === "coding" ? vscode.l10n.t("Coding Plan") : vscode.l10n.t("Standard Plan");
			const confirm = await vscode.window.showInformationMessage(
				vscode.l10n.t("Switch InfiniAI plan to {0}?", label),
				{ modal: true },
				vscode.l10n.t("Switch")
			);
			if (confirm !== vscode.l10n.t("Switch")) {
				return;
			}
			await vscode.workspace
				.getConfiguration("infiniai")
				.update("plan", next, vscode.ConfigurationTarget.Global);
		}),
		vscode.commands.registerCommand("infiniai.openSettings", () =>
			vscode.commands.executeCommand("workbench.action.openSettings", "infiniai")
		),
	];
	return vscode.Disposable.from(...disposables);
}
