import * as vscode from "vscode";

import { HttpError, NetworkError, RateLimitError, RequestTimeoutError } from "./utils";

const DASHBOARD_URL = "https://cloud.infini-ai.com";

export type ErrorCategory =
	| "auth"
	| "quota"
	| "rate-limit"
	| "network"
	| "timeout"
	| "model-not-found"
	| "server"
	| "unknown";

export interface CategorizedError {
	readonly category: ErrorCategory;
	readonly status?: number;
	readonly message: string;
}

export interface ActionableErrorContext {
	readonly providerGroup?: string;
	readonly modelId?: string;
}

function isInfiniAIAuthenticationRejection(err: HttpError): boolean {
	return (
		err.status === 401 ||
		err.status === 403 ||
		/wrong\s+bearer\s+token|api\s*key/i.test(err.body)
	);
}

export function categorizeError(err: unknown): CategorizedError | undefined {
	if (err instanceof vscode.CancellationError) {
		return undefined;
	}
	if (err instanceof RateLimitError) {
		return { category: "rate-limit", status: err.status, message: err.message };
	}
	if (err instanceof HttpError) {
		if (isInfiniAIAuthenticationRejection(err)) {
			return { category: "auth", status: err.status, message: err.message };
		}
		if (err.status === 402) {
			return { category: "quota", status: err.status, message: err.message };
		}
		if (err.status === 404 && /model/i.test(err.body)) {
			return { category: "model-not-found", status: err.status, message: err.message };
		}
		if (err.status >= 500) {
			return { category: "server", status: err.status, message: err.message };
		}
		return { category: "unknown", status: err.status, message: err.message };
	}
	if (err instanceof NetworkError) {
		return { category: "network", message: err.message };
	}
	if (err instanceof RequestTimeoutError) {
		return { category: "timeout", message: err.message };
	}
	const message = err instanceof Error ? err.message : String(err);
	if (/InfiniAI API key not found/i.test(message)) {
		return { category: "auth", message };
	}
	return undefined;
}

/** Show an actionable error toast for recoverable categories. Returns true if a toast was shown. */
export async function surfaceActionableError(
	err: unknown,
	context: ActionableErrorContext = {}
): Promise<boolean> {
	const info = categorizeError(err);
	if (!info) {
		return false;
	}
	switch (info.category) {
		case "auth":
			await showAuthError(context);
			return true;
		case "quota":
			await showQuotaError();
			return true;
		case "rate-limit":
			await showRateLimitError();
			return true;
		case "network":
			await showNetworkError(info.message);
			return true;
		case "timeout":
			await showNetworkError(info.message);
			return true;
		case "model-not-found":
			await showModelNotFoundError(info.message);
			return true;
		case "server":
			await showServerError(info.status ?? 0);
			return true;
		default:
			return false;
	}
}

async function showAuthError(context: ActionableErrorContext): Promise<void> {
	const manageModels = vscode.l10n.t("Manage Models");
	const getKey = vscode.l10n.t("Get API Key");
	const subject =
		context.modelId && context.providerGroup
			? vscode.l10n.t('InfiniAI rejected access to model "{0}" for provider group "{1}".', context.modelId, context.providerGroup)
			: context.providerGroup
				? vscode.l10n.t('InfiniAI rejected the API key for provider group "{0}".', context.providerGroup)
				: vscode.l10n.t("InfiniAI rejected this request.");
	const choice = await vscode.window.showErrorMessage(
		`${subject} ${vscode.l10n.t("Verify model access or update the provider-group API key.")}`,
		manageModels,
		getKey
	);
	if (choice === manageModels) {
		await vscode.commands.executeCommand("infiniai.openManageModels");
	} else if (choice === getKey) {
		await vscode.env.openExternal(vscode.Uri.parse(DASHBOARD_URL));
	}
}

async function showQuotaError(): Promise<void> {
	const dashboard = vscode.l10n.t("Open Dashboard");
	const manageModels = vscode.l10n.t("Manage Models");
	const choice = await vscode.window.showErrorMessage(
		vscode.l10n.t("InfiniAI quota exceeded. Top up your account or update your API key."),
		dashboard,
		manageModels
	);
	if (choice === dashboard) {
		await vscode.env.openExternal(vscode.Uri.parse(DASHBOARD_URL));
	} else if (choice === manageModels) {
		await vscode.commands.executeCommand("infiniai.openManageModels");
	}
}

async function showRateLimitError(): Promise<void> {
	const settings = vscode.l10n.t("Open Settings");
	const choice = await vscode.window.showWarningMessage(
		vscode.l10n.t(
			"InfiniAI rate limit hit. The request will be retried automatically; consider lowering request frequency."
		),
		settings
	);
	if (choice === settings) {
		await vscode.commands.executeCommand("workbench.action.openSettings", "infiniai");
	}
}

async function showNetworkError(detail: string): Promise<void> {
	const retry = vscode.l10n.t("Refresh Models");
	const settings = vscode.l10n.t("Open Settings");
	const choice = await vscode.window.showErrorMessage(
		vscode.l10n.t("Cannot reach InfiniAI: {0}", detail),
		retry,
		settings
	);
	if (choice === retry) {
		await vscode.commands.executeCommand("infiniai.refreshModels");
	} else if (choice === settings) {
		await vscode.commands.executeCommand("workbench.action.openSettings", "infiniai");
	}
}

async function showModelNotFoundError(detail: string): Promise<void> {
	const refresh = vscode.l10n.t("Refresh Models");
	const choice = await vscode.window.showErrorMessage(
		vscode.l10n.t("Model not found on InfiniAI: {0}", detail),
		refresh
	);
	if (choice === refresh) {
		await vscode.commands.executeCommand("infiniai.refreshModels");
	}
}

async function showServerError(status: number): Promise<void> {
	const dashboard = vscode.l10n.t("Open Dashboard");
	const choice = await vscode.window.showErrorMessage(
		vscode.l10n.t("InfiniAI server error (HTTP {0}). Automatic retries were exhausted.", status),
		dashboard
	);
	if (choice === dashboard) {
		await vscode.env.openExternal(vscode.Uri.parse(DASHBOARD_URL));
	}
}
