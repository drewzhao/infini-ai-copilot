import * as vscode from "vscode";

import { ChatUsageEvent, InfiniAIChatModelProvider } from "../provider";

const STATE_KEY = "infiniai.usageRecords.v1";
const MAX_RECORDS = 10000;

interface UsageRecord {
	readonly ts: number;
	readonly modelId: string;
	readonly transport: string;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cachedTokens?: number;
}

export class InfiniAIUsageDashboardProvider implements vscode.WebviewViewProvider, vscode.Disposable {
	public static readonly viewType = "infiniai.usageView";

	private _view?: vscode.WebviewView;
	private readonly _disposables: vscode.Disposable[] = [];
	private _records: UsageRecord[];

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly provider: InfiniAIChatModelProvider
	) {
		this._records = this.loadRecords();
		this._disposables.push(
			provider.onDidConsumeUsage((event) => this.handleUsage(event)),
			vscode.window.onDidChangeActiveColorTheme(() => this.postRender())
		);
	}

	dispose(): void {
		for (const d of this._disposables) {
			d.dispose();
		}
	}

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this._view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [],
		};
		webviewView.webview.html = this.renderHtml(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(
			(message) => this.handleMessage(message),
			undefined,
			this._disposables
		);

		webviewView.onDidDispose(
			() => {
				this._view = undefined;
			},
			undefined,
			this._disposables
		);

		this.postRender();
	}

	private handleUsage(event: ChatUsageEvent): void {
		this._records.push({
			ts: event.timestamp,
			modelId: event.modelId,
			transport: event.transport,
			inputTokens: event.inputTokens,
			outputTokens: event.outputTokens,
			cachedTokens: event.cachedTokens,
		});
		if (this._records.length > MAX_RECORDS) {
			this._records.splice(0, this._records.length - MAX_RECORDS);
		}
		void this.persistRecords();
		this.postRender();
	}

	private loadRecords(): UsageRecord[] {
		const raw = this.context.globalState.get<UsageRecord[]>(STATE_KEY, []);
		if (!Array.isArray(raw)) {
			return [];
		}
		return raw.slice(-MAX_RECORDS);
	}

	private persistRecords(): Thenable<void> {
		return this.context.globalState.update(STATE_KEY, this._records);
	}

	private async handleMessage(message: { type?: string }): Promise<void> {
		switch (message?.type) {
			case "ready":
				this.postRender();
				return;
			case "reset": {
				this._records = [];
				await this.persistRecords();
				this.postRender();
				return;
			}
			case "export": {
				await this.exportCsv();
				return;
			}
		}
	}

	private async exportCsv(): Promise<void> {
		if (this._records.length === 0) {
			void vscode.window.showInformationMessage(vscode.l10n.t("No usage data to export."));
			return;
		}
		const target = await vscode.window.showSaveDialog({
			defaultUri: vscode.Uri.file("infiniai-usage.csv"),
			filters: { CSV: ["csv"] },
			saveLabel: vscode.l10n.t("Export"),
		});
		if (!target) {
			return;
		}
		const header = "timestamp,iso,model,transport,input_tokens,output_tokens,cached_tokens\n";
		const rows = this._records
			.map((r) => {
				const iso = new Date(r.ts).toISOString();
				return [r.ts, iso, r.modelId, r.transport, r.inputTokens, r.outputTokens, r.cachedTokens ?? ""].join(",");
			})
			.join("\n");
		const data = Buffer.from(header + rows + "\n", "utf8");
		await vscode.workspace.fs.writeFile(target, data);
		void vscode.window.showInformationMessage(vscode.l10n.t("Usage data exported."));
	}

	private postRender(): void {
		if (!this._view) {
			return;
		}
		const summary = this.summarize(this._records);
		void this._view.webview.postMessage({
			type: "render",
			records: this._records.slice(-200).reverse(),
			summary,
			labels: this.labels(),
		});
	}

	private summarize(records: readonly UsageRecord[]): {
		total: { input: number; output: number; cached: number; requests: number };
		last24h: { input: number; output: number; requests: number };
		byModel: Array<{ modelId: string; input: number; output: number; requests: number }>;
	} {
		const cutoff = Date.now() - 24 * 60 * 60 * 1000;
		const total = { input: 0, output: 0, cached: 0, requests: records.length };
		const last24h = { input: 0, output: 0, requests: 0 };
		const byModel = new Map<string, { input: number; output: number; requests: number }>();
		for (const r of records) {
			total.input += r.inputTokens;
			total.output += r.outputTokens;
			total.cached += r.cachedTokens ?? 0;
			if (r.ts >= cutoff) {
				last24h.input += r.inputTokens;
				last24h.output += r.outputTokens;
				last24h.requests += 1;
			}
			const m = byModel.get(r.modelId) ?? { input: 0, output: 0, requests: 0 };
			m.input += r.inputTokens;
			m.output += r.outputTokens;
			m.requests += 1;
			byModel.set(r.modelId, m);
		}
		return {
			total,
			last24h,
			byModel: Array.from(byModel.entries())
				.map(([modelId, v]) => ({ modelId, ...v }))
				.sort((a, b) => b.input + b.output - (a.input + a.output))
				.slice(0, 10),
		};
	}

	private labels(): Record<string, string> {
		return {
			title: vscode.l10n.t("Local Usage"),
			subtitle: vscode.l10n.t(
				"Per-request usage captured locally from streaming responses. Account-level totals (Coming soon) require the InfiniAI usage API."
			),
			totalRequests: vscode.l10n.t("Requests"),
			totalInput: vscode.l10n.t("Input tokens"),
			totalOutput: vscode.l10n.t("Output tokens"),
			totalCached: vscode.l10n.t("Cached tokens"),
			last24hHeader: vscode.l10n.t("Last 24 hours"),
			byModelHeader: vscode.l10n.t("Top models"),
			recentHeader: vscode.l10n.t("Recent requests"),
			columnTime: vscode.l10n.t("Time"),
			columnModel: vscode.l10n.t("Model"),
			columnRoute: vscode.l10n.t("Route"),
			columnInput: vscode.l10n.t("Input"),
			columnOutput: vscode.l10n.t("Output"),
			columnCached: vscode.l10n.t("Cached"),
			reset: vscode.l10n.t("Reset"),
			exportCsv: vscode.l10n.t("Export CSV"),
			confirmReset: vscode.l10n.t("Clear all locally recorded usage data?"),
			empty: vscode.l10n.t("No usage data yet. Send a chat request to start tracking."),
			comingSoon: vscode.l10n.t("Account-level totals (Coming soon)"),
		};
	}

	private renderHtml(webview: vscode.Webview): string {
		const cspSource = webview.cspSource;
		const nonce = randomNonce();
		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
	body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 8px 12px; font-size: var(--vscode-font-size); }
	h2 { font-size: 1.1em; margin: 0 0 4px; }
	p.sub { color: var(--vscode-descriptionForeground); margin: 0 0 12px; }
	.row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
	.card { flex: 1 1 100px; background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-editorWidget-border); border-radius: 4px; padding: 8px; min-width: 100px; }
	.card .label { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
	.card .value { font-size: 1.3em; font-weight: 600; margin-top: 2px; }
	section { margin-top: 16px; }
	section h3 { font-size: 0.95em; margin: 0 0 6px; }
	table { width: 100%; border-collapse: collapse; font-size: 0.85em; }
	th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--vscode-editorWidget-border); }
	th { color: var(--vscode-descriptionForeground); font-weight: 500; }
	td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
	.actions { display: flex; gap: 8px; margin: 8px 0 16px; }
	button { font: inherit; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; padding: 4px 10px; border-radius: 2px; cursor: pointer; }
	button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
	button:hover { background: var(--vscode-button-hoverBackground); }
	.empty { color: var(--vscode-descriptionForeground); font-style: italic; }
	.coming-soon { opacity: 0.55; pointer-events: none; border: 1px dashed var(--vscode-editorWidget-border); padding: 8px; border-radius: 4px; margin-top: 12px; font-size: 0.85em; }
</style>
</head>
<body>
	<h2 id="title"></h2>
	<p class="sub" id="subtitle"></p>
	<div class="actions">
		<button id="exportBtn"></button>
		<button id="resetBtn" class="secondary"></button>
	</div>
	<div class="row" id="totals"></div>
	<section>
		<h3 id="last24Header"></h3>
		<div class="row" id="last24"></div>
	</section>
	<section>
		<h3 id="byModelHeader"></h3>
		<table id="byModelTable"><thead><tr></tr></thead><tbody></tbody></table>
	</section>
	<section>
		<h3 id="recentHeader"></h3>
		<table id="recentTable"><thead><tr></tr></thead><tbody></tbody></table>
		<p class="empty" id="recentEmpty" hidden></p>
	</section>
	<div class="coming-soon" id="comingSoon"></div>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		let labels = {};

		function fmt(n) { return Number(n || 0).toLocaleString(); }
		function fmtTs(ts) {
			const d = new Date(ts);
			return d.toLocaleString();
		}

		function renderCards(target, items) {
			target.innerHTML = items.map(([label, value]) => \`
				<div class="card">
					<div class="label">\${label}</div>
					<div class="value">\${value}</div>
				</div>\`).join('');
		}

		function renderByModel(table, byModel) {
			const headRow = table.querySelector('thead tr');
			headRow.innerHTML = \`<th>\${labels.columnModel}</th><th class="num">\${labels.columnInput}</th><th class="num">\${labels.columnOutput}</th><th class="num">\${labels.totalRequests}</th>\`;
			const tbody = table.querySelector('tbody');
			if (!byModel.length) {
				tbody.innerHTML = \`<tr><td colspan="4" class="empty">\${labels.empty}</td></tr>\`;
				return;
			}
			tbody.innerHTML = byModel.map(m => \`<tr><td>\${m.modelId}</td><td class="num">\${fmt(m.input)}</td><td class="num">\${fmt(m.output)}</td><td class="num">\${fmt(m.requests)}</td></tr>\`).join('');
		}

		function renderRecent(table, records) {
			const headRow = table.querySelector('thead tr');
			headRow.innerHTML = \`<th>\${labels.columnTime}</th><th>\${labels.columnModel}</th><th>\${labels.columnRoute}</th><th class="num">\${labels.columnInput}</th><th class="num">\${labels.columnOutput}</th><th class="num">\${labels.columnCached}</th>\`;
			const tbody = table.querySelector('tbody');
			const empty = document.getElementById('recentEmpty');
			if (!records.length) {
				tbody.innerHTML = '';
				empty.textContent = labels.empty;
				empty.hidden = false;
				return;
			}
			empty.hidden = true;
			tbody.innerHTML = records.map(r => \`<tr><td>\${fmtTs(r.ts)}</td><td>\${r.modelId}</td><td>\${r.transport}</td><td class="num">\${fmt(r.inputTokens)}</td><td class="num">\${fmt(r.outputTokens)}</td><td class="num">\${r.cachedTokens != null ? fmt(r.cachedTokens) : ''}</td></tr>\`).join('');
		}

		function applyLabels() {
			document.getElementById('title').textContent = labels.title;
			document.getElementById('subtitle').textContent = labels.subtitle;
			document.getElementById('exportBtn').textContent = labels.exportCsv;
			document.getElementById('resetBtn').textContent = labels.reset;
			document.getElementById('last24Header').textContent = labels.last24hHeader;
			document.getElementById('byModelHeader').textContent = labels.byModelHeader;
			document.getElementById('recentHeader').textContent = labels.recentHeader;
			document.getElementById('comingSoon').textContent = labels.comingSoon;
		}

		document.getElementById('exportBtn').addEventListener('click', () => vscode.postMessage({ type: 'export' }));
		document.getElementById('resetBtn').addEventListener('click', () => {
			if (confirm(labels.confirmReset)) {
				vscode.postMessage({ type: 'reset' });
			}
		});

		window.addEventListener('message', (event) => {
			const msg = event.data;
			if (msg.type !== 'render') return;
			labels = msg.labels;
			applyLabels();
			renderCards(document.getElementById('totals'), [
				[labels.totalRequests, fmt(msg.summary.total.requests)],
				[labels.totalInput, fmt(msg.summary.total.input)],
				[labels.totalOutput, fmt(msg.summary.total.output)],
				[labels.totalCached, fmt(msg.summary.total.cached)],
			]);
			renderCards(document.getElementById('last24'), [
				[labels.totalRequests, fmt(msg.summary.last24h.requests)],
				[labels.totalInput, fmt(msg.summary.last24h.input)],
				[labels.totalOutput, fmt(msg.summary.last24h.output)],
			]);
			renderByModel(document.getElementById('byModelTable'), msg.summary.byModel);
			renderRecent(document.getElementById('recentTable'), msg.records);
		});

		vscode.postMessage({ type: 'ready' });
	</script>
</body>
</html>`;
	}
}

function randomNonce(): string {
	const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
	let result = "";
	for (let i = 0; i < 32; i++) {
		result += chars[Math.floor(Math.random() * chars.length)];
	}
	return result;
}

export function registerInfiniAIUsageDashboard(
	context: vscode.ExtensionContext,
	provider: InfiniAIChatModelProvider
): vscode.Disposable {
	const dashboard = new InfiniAIUsageDashboardProvider(context, provider);
	const registration = vscode.window.registerWebviewViewProvider(
		InfiniAIUsageDashboardProvider.viewType,
		dashboard
	);
	return vscode.Disposable.from(registration, dashboard);
}
