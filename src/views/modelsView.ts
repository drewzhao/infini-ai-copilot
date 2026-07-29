import * as vscode from "vscode";

import {
	getHiddenModelIds,
	getVisibleModelIds,
	isModelHidden,
	showAllProviderModels,
	updateHiddenModelIds,
	updateVisibleModelIds,
} from "../modelVisibility";
import { InfiniAIChatModelProvider, type InfiniAIModelDescription } from "../provider";
import {
	endpointKindForTransport,
	getExactModelRouteOverride,
	matchesRoutePattern,
	parseModelRouteConfigs,
	resetExactModelRouteOverride,
	setExactModelRouteOverride,
	type ProtocolSwitchTransport,
} from "../route";
import type { ModelEndpointKind, ModelRoute } from "../types";
import { INFINIAI_API_KEY_SECRET_NAME, logDebug, sanitizeForLog } from "../utils";

interface ModelsRootNode {
	readonly kind: "models-root";
}

interface ModelNode {
	readonly kind: "model";
	readonly id: string;
	readonly hidden: boolean;
	readonly transport: string;
	readonly endpointKind: ModelEndpointKind;
	readonly routeSource: ModelRoute["source"];
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

function formatTransport(transport: string): string {
	switch (transport) {
		case "anthropic":
			return vscode.l10n.t("Anthropic Messages");
		case "openai":
			return vscode.l10n.t("OpenAI Chat Completions");
		case "vertex":
			return vscode.l10n.t("Vertex GenerateContent");
		default:
			return transport;
	}
}

function formatEndpointKind(endpointKind: ModelEndpointKind): string {
	return endpointKind;
}

function formatRouteSource(source: ModelRoute["source"]): string {
	return source;
}

function isProtocolSwitchCandidate(model: InfiniAIModelDescription, rawRoutes: unknown): boolean {
	const exact = getExactModelRouteOverride(rawRoutes, model.id);
	return model.defaultTransport === "anthropic" || exact?.transport === "openai" || exact?.transport === "anthropic";
}

function effectiveRouteAfterChange(
	model: InfiniAIModelDescription,
	rawRoutes: unknown
): { transport: string; source: ModelRoute["source"]; endpointKind: ModelEndpointKind } {
	const matched = parseModelRouteConfigs(rawRoutes).find((route) => matchesRoutePattern(model.id, route.pattern));
	if (matched) {
		return {
			transport: matched.transport,
			source: "user",
			endpointKind: endpointKindForTransport(matched.transport),
		};
	}
	return {
		transport: model.defaultTransport,
		source: model.defaultRouteSource,
		endpointKind: model.defaultEndpointKind,
	};
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
				if (event.key === INFINIAI_API_KEY_SECRET_NAME) {
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
			case "models-root": {
				const item = new vscode.TreeItem(vscode.l10n.t("Models"), vscode.TreeItemCollapsibleState.Expanded);
				item.iconPath = new vscode.ThemeIcon("server");
				item.contextValue = "infiniai.models";
				return item;
			}
			case "model": {
				const item = new vscode.TreeItem(node.id, vscode.TreeItemCollapsibleState.None);
				item.description = node.hidden
					? `${node.transport} \u00b7 ${node.maxInputTokens.toLocaleString()}/${node.maxOutputTokens.toLocaleString()} \u00b7 ${vscode.l10n.t("Hidden")}`
					: `${node.transport} \u00b7 ${node.maxInputTokens.toLocaleString()}/${node.maxOutputTokens.toLocaleString()}`;
				const lines = [
					vscode.l10n.t("Route: {0}", formatTransport(node.transport)),
					vscode.l10n.t("Route source: {0}", formatRouteSource(node.routeSource)),
					vscode.l10n.t("Endpoint: {0}", formatEndpointKind(node.endpointKind)),
					vscode.l10n.t("Picker visibility: {0}", node.hidden ? vscode.l10n.t("hidden") : vscode.l10n.t("visible")),
					vscode.l10n.t("Tools: {0}", node.toolCalling ? vscode.l10n.t("yes") : vscode.l10n.t("no")),
					vscode.l10n.t("Images: {0}", node.imageInput ? vscode.l10n.t("yes") : vscode.l10n.t("no")),
					vscode.l10n.t("Max input tokens: {0}", node.maxInputTokens.toLocaleString()),
					vscode.l10n.t("Max output tokens: {0}", node.maxOutputTokens.toLocaleString()),
				];
				item.tooltip = new vscode.MarkdownString(lines.map((l) => `- ${l}`).join("\n"));
				item.iconPath = new vscode.ThemeIcon(
					node.hidden ? "eye-closed" : node.imageInput ? "device-camera" : "symbol-method"
				);
				item.contextValue = node.hidden ? "infiniai.model.hidden" : "infiniai.model.visible";
				return item;
			}
			case "account-root": {
				const item = new vscode.TreeItem(vscode.l10n.t("Account"), vscode.TreeItemCollapsibleState.Expanded);
				item.iconPath = new vscode.ThemeIcon("account");
				item.contextValue = "infiniai.account";
				return item;
			}
			case "account": {
				const item = new vscode.TreeItem(vscode.l10n.t("API Key"), vscode.TreeItemCollapsibleState.None);
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
			return [{ kind: "models-root" }, { kind: "account-root" }, { kind: "usage" }];
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
							label: vscode.l10n.t('No models available. Run "InfiniAI: Set InfiniAI API Key".'),
						},
					];
				}
				return models.map<ModelNode>((m) => ({
					kind: "model",
					id: m.id,
					hidden: isModelHidden(m.id),
					transport: m.transport,
					endpointKind: m.endpointKind,
					routeSource: m.routeSource,
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
		const apiKey = await this.secrets.get(INFINIAI_API_KEY_SECRET_NAME);
		const children: InfiniNode[] = [
			{ kind: "account", fingerprint: fingerprint(apiKey) },
			{
				kind: "account-action",
				label: vscode.l10n.t("Manage Key\u2026"),
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
		vscode.commands.registerCommand("infiniai.hideModel", async (node?: InfiniNode) => {
			const modelId = await resolveModelId(node, provider, false);
			if (!modelId) {
				return;
			}
			const hiddenModelIds = getHiddenModelIds();
			const visibleModelIds = getVisibleModelIds();
			hiddenModelIds.add(modelId);
			visibleModelIds.delete(modelId);
			await updateHiddenModelIds([...hiddenModelIds]);
			await updateVisibleModelIds([...visibleModelIds]);
			provider.refreshModels();
			treeDataProvider.refresh();
			const action = await vscode.window.showInformationMessage(
				vscode.l10n.t("{0} is hidden from the chat model picker.", modelId),
				vscode.l10n.t("Show All")
			);
			if (action === vscode.l10n.t("Show All")) {
				await showAllProviderModels();
				provider.refreshModels();
				treeDataProvider.refresh();
			}
		}),
		vscode.commands.registerCommand("infiniai.showModel", async (node?: InfiniNode) => {
			const modelId = await resolveModelId(node, provider, true);
			if (!modelId) {
				return;
			}
			const hiddenModelIds = getHiddenModelIds();
			const visibleModelIds = getVisibleModelIds();
			hiddenModelIds.delete(modelId);
			visibleModelIds.add(modelId);
			await updateHiddenModelIds([...hiddenModelIds]);
			await updateVisibleModelIds([...visibleModelIds]);
			provider.refreshModels();
			treeDataProvider.refresh();
		}),
		vscode.commands.registerCommand("infiniai.showAllModels", async () => {
			await showAllProviderModels();
			provider.refreshModels();
			treeDataProvider.refresh();
		}),
		vscode.commands.registerCommand("infiniai.switchModelProtocol", async (node?: InfiniNode) => {
			const model = await resolveProtocolModel(node, provider);
			if (!model) {
				return;
			}
			await switchModelProtocol(model, provider, treeDataProvider);
		}),
		vscode.commands.registerCommand("infiniai.openSettings", () =>
			vscode.commands.executeCommand("workbench.action.openSettings", "infiniai")
		),
	];
	return vscode.Disposable.from(...disposables);
}

interface ProtocolModelPick extends vscode.QuickPickItem {
	readonly model: InfiniAIModelDescription;
}

interface ProtocolActionPick extends vscode.QuickPickItem {
	readonly transport?: ProtocolSwitchTransport;
	readonly reset?: boolean;
}

async function resolveProtocolModel(
	node: InfiniNode | undefined,
	provider: InfiniAIChatModelProvider
): Promise<InfiniAIModelDescription | undefined> {
	const cancel = new vscode.CancellationTokenSource();
	try {
		const models = await provider.getModelDescriptions(false, cancel.token);
		const rawRoutes = vscode.workspace.getConfiguration("infiniai").get<unknown>("modelRoutes", []);
		if (node?.kind === "model") {
			const model = models.find((candidate) => candidate.id === node.id);
			if (!model) {
				void vscode.window.showInformationMessage(vscode.l10n.t("InfiniAI model {0} is not available.", node.id));
				return undefined;
			}
			if (!isProtocolSwitchCandidate(model, rawRoutes)) {
				void vscode.window.showInformationMessage(
					vscode.l10n.t("{0} does not look like a Claude-compatible InfiniAI model.", model.id)
				);
				return undefined;
			}
			return model;
		}

		const picks = models
			.filter((model) => isProtocolSwitchCandidate(model, rawRoutes))
			.map<ProtocolModelPick>((model) => ({
				label: model.id,
				description: formatTransport(model.transport),
				detail: vscode.l10n.t("Effective route: {0} ({1})", model.transport, model.routeSource),
				model,
			}));
		if (picks.length === 0) {
			void vscode.window.showInformationMessage(vscode.l10n.t("No Claude-compatible InfiniAI models are available."));
			return undefined;
		}
		const pick = await vscode.window.showQuickPick(picks, {
			placeHolder: vscode.l10n.t("Select an InfiniAI model to switch protocol"),
			matchOnDescription: true,
			matchOnDetail: true,
		});
		return pick?.model;
	} finally {
		cancel.dispose();
	}
}

async function switchModelProtocol(
	model: InfiniAIModelDescription,
	provider: InfiniAIChatModelProvider,
	treeDataProvider: InfiniAIModelsTreeProvider
): Promise<void> {
	const config = vscode.workspace.getConfiguration("infiniai");
	const rawRoutes = config.get<unknown>("modelRoutes", []);
	const exact = getExactModelRouteOverride(rawRoutes, model.id);
	const picks: ProtocolActionPick[] = [
		{
			label: `${model.transport === "openai" ? "$(check) " : ""}${formatTransport("openai")}`,
			description: exact?.transport === "openai" ? vscode.l10n.t("Exact override") : undefined,
			transport: "openai",
		},
		{
			label: `${model.transport === "anthropic" ? "$(check) " : ""}${formatTransport("anthropic")}`,
			description: exact?.transport === "anthropic" ? vscode.l10n.t("Exact override") : undefined,
			transport: "anthropic",
		},
	];
	if (exact) {
		picks.push(
			{ label: vscode.l10n.t("Reset"), kind: vscode.QuickPickItemKind.Separator },
			{
				label: vscode.l10n.t("Reset exact override"),
				description: vscode.l10n.t("Use matching wildcard or catalog default"),
				reset: true,
			}
		);
	}

	const pick = await vscode.window.showQuickPick(picks, {
		placeHolder: vscode.l10n.t("Select protocol for {0}", model.id),
		matchOnDescription: true,
	});
	if (!pick) {
		return;
	}

	const nextRoutes = pick.reset
		? resetExactModelRouteOverride(rawRoutes, model.id)
		: setExactModelRouteOverride(rawRoutes, model.id, pick.transport ?? "anthropic");
	await config.update("modelRoutes", nextRoutes, vscode.ConfigurationTarget.Global);
	provider.refreshModels();
	treeDataProvider.refresh();

	const effective = effectiveRouteAfterChange(model, nextRoutes);
	const source = effective.source === "user" && pick.reset ? vscode.l10n.t("matching override") : effective.source;
	void vscode.window.showInformationMessage(
		vscode.l10n.t("{0} now uses {1} ({2}).", model.id, formatTransport(effective.transport), source)
	);
}

async function resolveModelId(
	node: InfiniNode | undefined,
	provider: InfiniAIChatModelProvider,
	hiddenOnly: boolean
): Promise<string | undefined> {
	if (node?.kind === "model") {
		return node.id;
	}
	const cancel = new vscode.CancellationTokenSource();
	try {
		const models = await provider.getModelDescriptions(false, cancel.token);
		const picks = models
			.filter((model) => (hiddenOnly ? isModelHidden(model.id) : !isModelHidden(model.id)))
			.map((model) => ({
				label: model.id,
				description: model.transport,
			}));
		if (picks.length === 0) {
			void vscode.window.showInformationMessage(
				hiddenOnly ? vscode.l10n.t("No hidden InfiniAI models.") : vscode.l10n.t("No visible InfiniAI models to hide.")
			);
			return undefined;
		}
		const pick = await vscode.window.showQuickPick(picks, {
			placeHolder: hiddenOnly
				? vscode.l10n.t("Select an InfiniAI model to show")
				: vscode.l10n.t("Select an InfiniAI model to hide"),
		});
		return pick?.label;
	} finally {
		cancel.dispose();
	}
}
