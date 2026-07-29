/**
 * Default model-id patterns whose APIs require disabling thinking mode
 * because their `reasoning_content` cannot yet be round-tripped through all
 * VS Code/Copilot Chat request paths.
 *
 * - Known Xiaomi MiMo V2 model IDs: require `reasoning_content` to be
 *   echoed back on subsequent turns when the conversation contains tool
 *   calls, otherwise the API returns HTTP 400.
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

/**
 * Built-in replay-capable model IDs and families. These profiles have
 * provider-native replay adapters and preflight, including whole-history replay
 * for preserved-thinking Kimi models.
 */
export const DEFAULT_ENABLE_THINKING_ROUND_TRIP_PATTERNS: readonly string[] = [
	"mimo-v2*",
	"deepseek-v4*",
	"deepseek-r1",
	"deepseek-v3.2-thinking",
	"glm-5*",
	"glm-4.7*",
	"kimi-k2-thinking",
	"kimi-k2.5",
	"kimi-k2.6",
	"kimi-k2.7-code",
	"kimi-k2.7-code-highspeed",
	"kimi-k3",
	"minimax*",
];

export type ThinkingReplayStoreMode = "localPlaintext" | "memory";

export const DEFAULT_THINKING_REPLAY_STORE_MODE: ThinkingReplayStoreMode = "localPlaintext";

type InfiniAIConfiguration = {
	get<T>(key: string, defaultValue: T): T;
};

function getInfiniAIConfiguration(): InfiniAIConfiguration {
	// Delay the `vscode` require so pure unit tests for pattern matching can run
	// under Node without the VS Code extension host module.
	const vscode = require("vscode") as typeof import("vscode");
	return vscode.workspace.getConfiguration("infiniai");
}

function uniquePatterns(patterns: readonly string[]): string[] {
	return [...new Set(patterns)];
}

function asPatternList(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

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
 * Read the effective disable-thinking pattern list from VS Code settings. User
 * patterns are additions to the built-in safety defaults, not replacements.
 */
export function getEffectiveDisableThinkingPatterns(): string[] {
	const cfg = getInfiniAIConfiguration();
	const user = asPatternList(cfg.get<unknown>("disableThinkingForModels", []));
	return uniquePatterns([...DEFAULT_DISABLE_THINKING_PATTERNS, ...user]);
}

/**
 * Backward-compatible name for callers that already consume the effective list.
 */
export function getDisableThinkingPatterns(): string[] {
	return getEffectiveDisableThinkingPatterns();
}

/**
 * Read the effective thinking round-trip list. User patterns extend the
 * built-in replay-capable family defaults.
 */
export function getThinkingRoundTripPatterns(): string[] {
	const cfg = getInfiniAIConfiguration();
	const user = asPatternList(cfg.get<unknown>("enableThinkingRoundTripForModels", []));
	return uniquePatterns([...DEFAULT_ENABLE_THINKING_ROUND_TRIP_PATTERNS, ...user]);
}

/**
 * Returns true when `modelId` matches the explicit round-trip opt-in list.
 */
export function shouldEnableThinkingRoundTrip(modelId: string, patterns: readonly string[]): boolean {
	return shouldDisableThinking(modelId, patterns);
}

/**
 * Read the replay backend selection. `localPlaintext` is the normal product
 * default; `memory` is an explicit opt-in for users who do not want replay
 * data written to disk and accept losing restart continuity.
 */
export function getThinkingReplayStoreMode(): ThinkingReplayStoreMode {
	const cfg = getInfiniAIConfiguration();
	const configured = cfg.get<unknown>("thinkingReplayStore", DEFAULT_THINKING_REPLAY_STORE_MODE);
	return configured === "memory" || configured === "localPlaintext" ? configured : DEFAULT_THINKING_REPLAY_STORE_MODE;
}

/**
 * Conservative predicate for whether this request path can preserve and replay
 * `reasoning_content` end to end. Constructor availability alone is not enough.
 */
export function isKnownThinkingRoundTripSafeRequest(): boolean {
	return false;
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
