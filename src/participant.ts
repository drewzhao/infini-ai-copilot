import * as vscode from "vscode";

import { InfiniAIChatModelProvider } from "./provider";
import { InfiniAILogger, logError, sanitizeForLog } from "./utils";

function boolText(value: boolean): string {
	return value ? vscode.l10n.t("yes") : vscode.l10n.t("no");
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
						`## ${vscode.l10n.t("InfiniAI Doctor")}`,
						"",
						`- ${vscode.l10n.t("VS Code")}: ${diagnostic.vscodeVersion}`,
						`- ${vscode.l10n.t("API key present")}: ${boolText(diagnostic.hasApiKey)}`,
						`- ${vscode.l10n.t("Discovery endpoint")}: ${diagnostic.modelDiscoveryUrl}`,
						`- ${vscode.l10n.t("Cached models")}: ${diagnostic.modelCount}`,
						...(diagnostic.discoveryStats
							? [
									`- ${vscode.l10n.t("Discovery summary")}: ` +
										`${diagnostic.discoveryStats.rawModelCount} ${vscode.l10n.t("rows")}; ` +
										`${diagnostic.discoveryStats.chatModelCount} ${vscode.l10n.t("chat-eligible")}; ` +
										`${diagnostic.discoveryStats.nonChatModelCount} ${vscode.l10n.t("non-chat filtered")}; ` +
										`${diagnostic.discoveryStats.unknownModelTypeCount} ${vscode.l10n.t("unknown-type filtered")}; ` +
										`${diagnostic.discoveryStats.malformedModelCount} ${vscode.l10n.t("malformed")}; ` +
										`${diagnostic.discoveryStats.duplicateModelCount} ${vscode.l10n.t("duplicate")}; ` +
										`${diagnostic.discoveryStats.liveOutputLimitCount} ${vscode.l10n.t("live output limits")}`,
								]
							: []),
						`- ${vscode.l10n.t("Route overrides")}: ${diagnostic.routeConfigCount}`,
						`- ${vscode.l10n.t("Exact model route overrides")}: ${diagnostic.exactModelRouteOverrideCount}`,
						`- ${vscode.l10n.t("Cache age")}: ${formatAge(diagnostic.cacheAgeMs)}`,
						diagnostic.lastError
							? `- ${vscode.l10n.t("Last error")}: ${sanitizeForLog(diagnostic.lastError, 240)}`
							: `- ${vscode.l10n.t("Last error")}: ${vscode.l10n.t("none")}`,
					].join("\n")
				);
				return;
			}

			if (request.command === "models") {
				const refresh = /\brefresh\b/i.test(request.prompt);
				const models = await provider.getModelDescriptions(refresh, token);
				if (models.length === 0) {
					stream.markdown(
						vscode.l10n.t("No InfiniAI models are available. Run `InfiniAI: Set InfiniAI Apikey`, then try again.")
					);
					return;
				}
				const rows = models
					.slice(0, 50)
					.map(
						(model) =>
							`| \`${model.id}\` | ${model.transport} | ${model.routeSource} | ${boolText(!!model.toolCalling)} | ${boolText(!!model.imageInput)} | ${model.maxInputTokens}/${model.maxOutputTokens} |`
					);
				stream.markdown(
					[
						`## ${vscode.l10n.t("InfiniAI Models")}`,
						"",
						`| ${vscode.l10n.t("Model")} | ${vscode.l10n.t("Route")} | ${vscode.l10n.t("Source")} | ${vscode.l10n.t("Tools")} | ${vscode.l10n.t("Images")} | ${vscode.l10n.t("Input/Output Tokens")} |`,
						"|---|---:|---:|---:|---:|---:|",
						...rows,
						models.length > 50 ? `\n${vscode.l10n.t("Showing 50 of {0} models.", models.length)}` : "",
					].join("\n")
				);
				return;
			}

			if (request.command === "test") {
				const result = await provider.testRoute(request.prompt.trim(), token);
				stream.markdown(vscode.l10n.t("InfiniAI test passed: {0}", result));
				return;
			}

			stream.markdown(
				[
					vscode.l10n.t("Use one of the InfiniAI diagnostics commands:"),
					"",
					`- \`/doctor\` ${vscode.l10n.t("checks configuration and provider health.")}`,
					`- \`/models\` ${vscode.l10n.t("lists discovered models and capabilities.")}`,
					`- \`/models refresh\` ${vscode.l10n.t("refreshes model discovery before listing.")}`,
					`- \`/test\` ${vscode.l10n.t("runs a minimal connectivity request.")}`,
				].join("\n")
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logError(output, `InfiniAI participant failed: ${sanitizeForLog(message)}`);
			if (err instanceof vscode.CancellationError) {
				throw err;
			}
			stream.markdown(vscode.l10n.t("InfiniAI command failed: {0}", sanitizeForLog(message, 240)));
		}
	});
	participant.iconPath = new vscode.ThemeIcon("sparkle");
	return participant;
}
