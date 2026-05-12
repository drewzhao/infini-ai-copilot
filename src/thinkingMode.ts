import * as vscode from "vscode";

/**
 * Default model-id patterns whose APIs require disabling thinking mode
 * because their `reasoning_content` cannot be round-tripped through the
 * stable VS Code language-model API.
 *
 * - Xiaomi MiMo V2 family: requires `reasoning_content` to be echoed back
 *   on subsequent turns when the conversation contains tool calls,
 *   otherwise the API returns HTTP 400.
 * - DeepSeek V4 family: same requirement, same 400 error string.
 *
 * Both can be neutralized by never enabling thinking mode in the first
 * place. The trade-off is loss of chain-of-thought quality on these
 * models; agentic tool-call loops will still function correctly.
 *
 * Patterns support `*` as a wildcard. Comparisons are case-insensitive.
 */
export const DEFAULT_DISABLE_THINKING_PATTERNS: readonly string[] = [
	"mimo-v2-pro",
	"mimo-v2.5-pro",
	"mimo-v2.5",
	"mimo-v2-omni",
	"mimo-v2-flash",
	"deepseek-v4*",
];

function escapeRegexLiteral(input: string): string {
	return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesPattern(modelId: string, pattern: string): boolean {
	if (!pattern) {
		return false;
	}
	const id = modelId.toLowerCase();
	const pat = pattern.toLowerCase();
	if (pat === id) {
		return true;
	}
	if (!pat.includes("*")) {
		return false;
	}
	const segments = pat.split("*").map(escapeRegexLiteral);
	return new RegExp(`^${segments.join(".*")}$`).test(id);
}

/**
 * Returns true when `modelId` matches any of `patterns`.
 */
export function shouldDisableThinking(modelId: string, patterns: readonly string[]): boolean {
	if (!modelId) {
		return false;
	}
	for (const p of patterns) {
		if (matchesPattern(modelId, p)) {
			return true;
		}
	}
	return false;
}

/**
 * Read the effective disable-thinking pattern list from VS Code settings.
 * Falls back to {@link DEFAULT_DISABLE_THINKING_PATTERNS} when the user
 * has not customized `infiniai.disableThinkingForModels`.
 */
export function getDisableThinkingPatterns(): string[] {
	const cfg = vscode.workspace.getConfiguration("infiniai");
	return cfg.get<string[]>("disableThinkingForModels", [...DEFAULT_DISABLE_THINKING_PATTERNS]);
}

/**
 * Mutate an OpenAI-compatible request body to explicitly disable thinking
 * mode. Sets both vendor flavors (`enable_thinking` and `thinking.type`)
 * so the request works regardless of which family the upstream service
 * recognizes; unknown fields are ignored by both MiMo and DeepSeek.
 */
export function applyDisableThinking(rb: Record<string, unknown>): void {
	rb.enable_thinking = false;
	rb.thinking = { type: "disabled" };
}
