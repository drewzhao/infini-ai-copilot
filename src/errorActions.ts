import * as vscode from "vscode";

import { HttpError, NetworkError, RateLimitError } from "./utils";

const DASHBOARD_URL = "https://cloud.infini-ai.com";

type ErrorCategory = "auth" | "quota" | "rate-limit" | "network" | "model-not-found" | "server" | "unknown";

interface CategorizedError {
	readonly category: ErrorCategory;
	readonly status?: number;
	readonly message: string;
}

export function categorizeError(err: unknown): CategorizedError | undefined {
	if (err instanceof vscode.CancellationError) {
		return undefined;
	}
	if (err instanceof RateLimitError) {
		return { category: "rate-limit", status: err.status, message: err.message };
	}
	if (err instanceof HttpError) {
		if (err.status === 401 || err.status === 403) {
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
	const message = err instanceof Error ? err.message : String(err);
	if (/InfiniAI API key not found/i.test(message)) {
		return { category: "auth", message };
	}
	return undefined;
}

/** Show an actionable error toast for recoverable categories. Returns true if a toast was shown. */
export async function surfaceActionableError(err: unknown): Promise<boolean> {
	const info = categorizeError(err);
	if (!info) {
		return false;
	}
	switch (info.category) {
		case "auth":
			await showAuthError();
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

async function showAuthError(): Promise<void> {
	const setKey = vscode.l10n.t("Set API Key");
	const getKey = vscode.l10n.t("Get API Key");
	const settings = vscode.l10n.t("Open Settings");
	const choice = await vscode.window.showErrorMessage(
		vscode.l10n.t("InfiniAI API key is missing or invalid."),
		setKey,
		getKey,
		settings
	);
	if (choice === setKey) {
		await vscode.commands.executeCommand("infiniai.setApikey");
	} else if (choice === getKey) {
		await vscode.env.openExternal(vscode.Uri.parse(DASHBOARD_URL));
	} else if (choice === settings) {
		await vscode.commands.executeCommand("workbench.action.openSettings", "infiniai");
	}
}

async function showQuotaError(): Promise<void> {
	const dashboard = vscode.l10n.t("Open Dashboard");
	const switchPlan = vscode.l10n.t("Switch Plan");
	const choice = await vscode.window.showErrorMessage(
		vscode.l10n.t("InfiniAI quota exceeded. Top up your plan or switch accounts."),
		dashboard,
		switchPlan
	);
	if (choice === dashboard) {
		await vscode.env.openExternal(vscode.Uri.parse(DASHBOARD_URL));
	} else if (choice === switchPlan) {
		await vscode.commands.executeCommand("infiniai.switchPlan");
	}
}

async function showRateLimitError(): Promise<void> {
	const settings = vscode.l10n.t("Open Settings");
	const choice = await vscode.window.showWarningMessage(
		vscode.l10n.t("InfiniAI rate limit hit. The request will be retried automatically; consider lowering request frequency."),
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
		vscode.l10n.t("InfiniAI server error (HTTP {0}). The request will be retried automatically.", status),
		dashboard
	);
	if (choice === dashboard) {
		await vscode.env.openExternal(vscode.Uri.parse(DASHBOARD_URL));
	}
}
