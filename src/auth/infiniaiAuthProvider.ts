import * as vscode from "vscode";

import { getApiKeySecretName, InfiniAIPlan } from "../utils";

const PLAN_BY_SESSION_ID: Record<string, InfiniAIPlan> = {
	"infiniai.standard": "standard",
	"infiniai.coding": "coding",
};

const SESSION_ID_BY_PLAN: Record<InfiniAIPlan, string> = {
	standard: "infiniai.standard",
	coding: "infiniai.coding",
};

const ACCOUNT_LABEL_BY_PLAN: Record<InfiniAIPlan, string> = {
	standard: "Standard Plan",
	coding: "Coding Plan",
};

const SCOPES_BY_PLAN: Record<InfiniAIPlan, string[]> = {
	standard: ["standard"],
	coding: ["coding"],
};

export const INFINIAI_AUTH_PROVIDER_ID = "infiniai";
export const INFINIAI_AUTH_PROVIDER_LABEL = "InfiniAI";

function planFromScopes(scopes: readonly string[] | undefined): InfiniAIPlan | undefined {
	if (!scopes || scopes.length === 0) {
		return undefined;
	}
	for (const scope of scopes) {
		if (scope === "coding" || scope === "standard") {
			return scope;
		}
	}
	return undefined;
}

function fingerprint(key: string): string {
	const tail = key.length >= 4 ? key.slice(-4) : key;
	return `\u2026${tail}`;
}

export interface PlanInputProvider {
	promptPlan(currentlyConfigured: InfiniAIPlan | undefined): Promise<InfiniAIPlan | undefined>;
	promptApiKey(plan: InfiniAIPlan, existing: string | undefined): Promise<string | undefined>;
}

/**
 * AuthenticationProvider that surfaces the InfiniAI API keys in the Accounts menu.
 *
 * Two logical accounts are exposed (one per plan). Each session's `accessToken`
 * is the API key currently stored in `SecretStorage`. Sessions are read on
 * demand from `SecretStorage` so behavior stays consistent with the rest of
 * the extension when keys change in another window.
 */
export class InfiniAIAuthenticationProvider implements vscode.AuthenticationProvider, vscode.Disposable {
	private readonly _onDidChangeSessions = new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
	readonly onDidChangeSessions = this._onDidChangeSessions.event;

	private readonly _disposables: vscode.Disposable[] = [];

	constructor(
		private readonly secrets: vscode.SecretStorage,
		private readonly inputProvider: PlanInputProvider
	) {
		this._disposables.push(
			this.secrets.onDidChange((event) => {
				if (event.key === getApiKeySecretName("standard")) {
					this.fireChangeForPlan("standard");
				} else if (event.key === getApiKeySecretName("coding")) {
					this.fireChangeForPlan("coding");
				}
			})
		);
	}

	dispose(): void {
		for (const disposable of this._disposables) {
			disposable.dispose();
		}
		this._onDidChangeSessions.dispose();
	}

	async getSessions(scopes?: readonly string[]): Promise<vscode.AuthenticationSession[]> {
		const requested = planFromScopes(scopes);
		const plans: InfiniAIPlan[] = requested ? [requested] : ["standard", "coding"];
		const sessions: vscode.AuthenticationSession[] = [];
		for (const plan of plans) {
			const session = await this.readSession(plan);
			if (session) {
				sessions.push(session);
			}
		}
		return sessions;
	}

	async createSession(scopes: readonly string[]): Promise<vscode.AuthenticationSession> {
		const requested = planFromScopes(scopes);
		const plan = requested ?? (await this.inputProvider.promptPlan(undefined));
		if (!plan) {
			throw new Error(vscode.l10n.t("InfiniAI sign-in canceled."));
		}
		const existing = await this.secrets.get(getApiKeySecretName(plan));
		const apiKey = await this.inputProvider.promptApiKey(plan, existing);
		if (!apiKey) {
			throw new Error(vscode.l10n.t("InfiniAI sign-in canceled."));
		}
		await this.secrets.store(getApiKeySecretName(plan), apiKey);
		const session = this.buildSession(plan, apiKey);
		this._onDidChangeSessions.fire({ added: [session], removed: [], changed: [] });
		return session;
	}

	async removeSession(sessionId: string): Promise<void> {
		const plan = PLAN_BY_SESSION_ID[sessionId];
		if (!plan) {
			return;
		}
		const apiKey = await this.secrets.get(getApiKeySecretName(plan));
		await this.secrets.delete(getApiKeySecretName(plan));
		if (apiKey) {
			const removed = this.buildSession(plan, apiKey);
			this._onDidChangeSessions.fire({ added: [], removed: [removed], changed: [] });
		}
	}

	private async readSession(plan: InfiniAIPlan): Promise<vscode.AuthenticationSession | undefined> {
		const apiKey = await this.secrets.get(getApiKeySecretName(plan));
		if (!apiKey) {
			return undefined;
		}
		return this.buildSession(plan, apiKey);
	}

	private buildSession(plan: InfiniAIPlan, apiKey: string): vscode.AuthenticationSession {
		const sessionId = SESSION_ID_BY_PLAN[plan];
		return {
			id: sessionId,
			accessToken: apiKey,
			account: {
				id: sessionId,
				label: vscode.l10n.t("InfiniAI ({0}) {1}", ACCOUNT_LABEL_BY_PLAN[plan], fingerprint(apiKey)),
			},
			scopes: SCOPES_BY_PLAN[plan],
		};
	}

	private async fireChangeForPlan(plan: InfiniAIPlan): Promise<void> {
		const apiKey = await this.secrets.get(getApiKeySecretName(plan));
		const session = apiKey ? this.buildSession(plan, apiKey) : undefined;
		if (session) {
			this._onDidChangeSessions.fire({ added: [], removed: [], changed: [session] });
		} else {
			const removed: vscode.AuthenticationSession = {
				id: SESSION_ID_BY_PLAN[plan],
				accessToken: "",
				account: { id: SESSION_ID_BY_PLAN[plan], label: ACCOUNT_LABEL_BY_PLAN[plan] },
				scopes: SCOPES_BY_PLAN[plan],
			};
			this._onDidChangeSessions.fire({ added: [], removed: [removed], changed: [] });
		}
	}
}
