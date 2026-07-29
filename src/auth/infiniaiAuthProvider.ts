import * as vscode from "vscode";

import { INFINIAI_API_KEY_SECRET_NAME } from "../utils";

const SESSION_ID = "infiniai";
const SESSION_SCOPES = ["api"];

export const INFINIAI_AUTH_PROVIDER_ID = "infiniai";
export const INFINIAI_AUTH_PROVIDER_LABEL = "InfiniAI";

function fingerprint(key: string): string {
	const tail = key.length >= 4 ? key.slice(-4) : key;
	return `\u2026${tail}`;
}

export interface ApiKeyInputProvider {
	promptApiKey(existing: string | undefined): Promise<string | undefined>;
}

/**
 * AuthenticationProvider that surfaces the single InfiniAI API key in the
 * Accounts menu.
 */
export class InfiniAIAuthenticationProvider implements vscode.AuthenticationProvider, vscode.Disposable {
	private readonly _onDidChangeSessions =
		new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
	readonly onDidChangeSessions = this._onDidChangeSessions.event;

	private readonly _disposables: vscode.Disposable[] = [];
	private currentSession: vscode.AuthenticationSession | undefined;
	private sessionInitialized = false;
	private sessionSync: Promise<void> = Promise.resolve();

	constructor(
		private readonly secrets: vscode.SecretStorage,
		private readonly inputProvider: ApiKeyInputProvider
	) {
		this._disposables.push(
			this.secrets.onDidChange((event) => {
				if (event.key === INFINIAI_API_KEY_SECRET_NAME) {
					void this.queueSessionSync();
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

	async getSessions(_scopes?: readonly string[]): Promise<vscode.AuthenticationSession[]> {
		await this.initializeSession();
		return this.currentSession ? [this.currentSession] : [];
	}

	async createSession(_scopes: readonly string[]): Promise<vscode.AuthenticationSession> {
		const session = await this.configureSession();
		if (!session) {
			throw new Error(vscode.l10n.t("InfiniAI sign-in canceled."));
		}
		return session;
	}

	async configureSession(): Promise<vscode.AuthenticationSession | undefined> {
		await this.initializeSession();
		const apiKey = await this.inputProvider.promptApiKey(this.currentSession?.accessToken);
		if (!apiKey) {
			return undefined;
		}
		await this.secrets.store(INFINIAI_API_KEY_SECRET_NAME, apiKey);
		await this.queueSessionSync();
		return this.buildSession(apiKey);
	}

	async removeSession(sessionId: string): Promise<void> {
		if (sessionId !== SESSION_ID) {
			return;
		}
		await this.initializeSession();
		await this.secrets.delete(INFINIAI_API_KEY_SECRET_NAME);
		await this.queueSessionSync();
	}

	private async initializeSession(): Promise<void> {
		await this.sessionSync;
		if (this.sessionInitialized) {
			return;
		}
		const apiKey = await this.secrets.get(INFINIAI_API_KEY_SECRET_NAME);
		this.currentSession = apiKey ? this.buildSession(apiKey) : undefined;
		this.sessionInitialized = true;
	}

	private buildSession(apiKey: string): vscode.AuthenticationSession {
		return {
			id: SESSION_ID,
			accessToken: apiKey,
			account: {
				id: SESSION_ID,
				label: vscode.l10n.t("InfiniAI {0}", fingerprint(apiKey)),
			},
			scopes: SESSION_SCOPES,
		};
	}

	private queueSessionSync(): Promise<void> {
		const sync = this.sessionSync.then(() => this.syncSessionChange());
		this.sessionSync = sync.catch(() => undefined);
		return sync;
	}

	private async syncSessionChange(): Promise<void> {
		const previous = this.currentSession;
		const apiKey = await this.secrets.get(INFINIAI_API_KEY_SECRET_NAME);
		const current = apiKey ? this.buildSession(apiKey) : undefined;
		this.currentSession = current;
		this.sessionInitialized = true;

		if (!previous && current) {
			this._onDidChangeSessions.fire({ added: [current], removed: [], changed: [] });
			return;
		}
		if (previous && !current) {
			this._onDidChangeSessions.fire({ added: [], removed: [previous], changed: [] });
			return;
		}
		if (previous && current && previous.accessToken !== current.accessToken) {
			this._onDidChangeSessions.fire({ added: [], removed: [], changed: [current] });
		}
	}
}
