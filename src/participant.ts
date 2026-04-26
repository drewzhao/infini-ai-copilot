import * as vscode from "vscode";

import { InfiniAIChatModelProvider } from "./provider";
import { InfiniAILogger, logError, sanitizeForLog } from "./utils";

function boolText(value: boolean): string {
	return value ? "yes" : "no";
}

function formatAge(ageMs: number | undefined): string {
	if (ageMs === undefined) {
		return "n/a";
	}
	if (ageMs < 1000) {
		return `${ageMs}ms`;
	}
	const seconds = Math.round(ageMs / 1000);
	if (seconds < 60) {
		return `${seconds}s`;
	}
	return `${Math.round(seconds / 60)}m`;
}

export function registerInfiniAIChatParticipant(
	provider: InfiniAIChatModelProvider,
	output: InfiniAILogger
): vscode.Disposable {
	const participant = vscode.chat.createChatParticipant("infiniai", async (request, _context, stream, token) => {
		try {
			if (request.command === "doctor") {
				const diagnostic = await provider.getDiagnostics(token);
				stream.markdown(
					[
						"## InfiniAI Doctor",
						"",
						`- VS Code: ${diagnostic.vscodeVersion}`,
						`- Active plan: ${diagnostic.plan}`,
						`- Standard key present: ${boolText(diagnostic.hasStandardKey)}`,
						`- Coding key present: ${boolText(diagnostic.hasCodingKey)}`,
						`- Discovery endpoint: ${diagnostic.modelDiscoveryUrl}`,
						`- Cached models: ${diagnostic.modelCount}`,
						`- Cache age: ${formatAge(diagnostic.cacheAgeMs)}`,
						diagnostic.lastError ? `- Last error: ${sanitizeForLog(diagnostic.lastError, 240)}` : "- Last error: none",
					].join("\n")
				);
				return;
			}

			if (request.command === "models") {
				const refresh = /\brefresh\b/i.test(request.prompt);
				const models = await provider.getModelDescriptions(refresh, token);
				if (models.length === 0) {
					stream.markdown("No InfiniAI models are available. Run `InfiniAI: Set InfiniAI Apikey`, then try again.");
					return;
				}
				const rows = models
					.slice(0, 50)
					.map(
						(model) =>
							`| \`${model.id}\` | ${model.transport} | ${boolText(!!model.toolCalling)} | ${boolText(!!model.imageInput)} | ${model.maxInputTokens}/${model.maxOutputTokens} |`
					);
				stream.markdown(
					[
						"## InfiniAI Models",
						"",
						"| Model | Route | Tools | Images | Input/Output Tokens |",
						"|---|---:|---:|---:|---:|",
						...rows,
						models.length > 50 ? `\nShowing 50 of ${models.length} models.` : "",
					].join("\n")
				);
				return;
			}

			if (request.command === "test") {
				const result = await provider.testRoute(request.prompt.trim(), token);
				stream.markdown(`InfiniAI test passed: ${result}`);
				return;
			}

			stream.markdown(
				[
					"Use one of the InfiniAI diagnostics commands:",
					"",
					"- `/doctor` checks configuration and provider health.",
					"- `/models` lists discovered models and capabilities.",
					"- `/models refresh` refreshes model discovery before listing.",
					"- `/test` runs a minimal connectivity request.",
				].join("\n")
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logError(output, `InfiniAI participant failed: ${sanitizeForLog(message)}`);
			if (err instanceof vscode.CancellationError) {
				throw err;
			}
			stream.markdown(`InfiniAI command failed: ${sanitizeForLog(message, 240)}`);
		}
	});
	participant.iconPath = new vscode.ThemeIcon("sparkle");
	return participant;
}
