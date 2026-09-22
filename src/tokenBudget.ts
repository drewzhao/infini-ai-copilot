export const PRACTICAL_OUTPUT_RESERVE_TOKENS = 16384;
export const PRACTICAL_OUTPUT_RESERVE_CONTEXT_RATIO = 0.25;
/**
 * Practical cap for the advertised (and Anthropic-route default request) max
 * output tokens. Catalog entries like kimi-k3 publish max_output_length equal
 * to the full context window; passing that through makes maxInput+maxOutput
 * ≈ 2× the real window, which breaks consumers that derive a context window
 * by summing the two (VS Code agents-window BYOK bridge). The OpenAI route
 * sends no max_tokens by default; explicit per-model configuration may still
 * exceed this cap.
 */
export const PRACTICAL_MAX_OUTPUT_TOKENS = 32768;

function finitePositiveInteger(value: number | undefined): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return undefined;
	}
	return Math.floor(value);
}

export function computePracticalOutputReserve(
	contextLength: number | undefined,
	providerMaxOutputTokens: number | undefined
): number {
	const context = finitePositiveInteger(contextLength);
	if (!context || context <= 1) {
		return 0;
	}
	const maxProviderReserve = finitePositiveInteger(providerMaxOutputTokens) ?? PRACTICAL_OUTPUT_RESERVE_TOKENS;
	const ratioReserve = Math.floor(context * PRACTICAL_OUTPUT_RESERVE_CONTEXT_RATIO);
	const reserve = Math.min(maxProviderReserve, PRACTICAL_OUTPUT_RESERVE_TOKENS, ratioReserve, context - 1);
	return Math.max(0, reserve);
}

export function computeAdvertisedMaxInputTokens(
	contextLength: number | undefined,
	providerMaxOutputTokens: number | undefined
): number | undefined {
	const context = finitePositiveInteger(contextLength);
	if (!context) {
		return undefined;
	}
	return Math.max(1, context - computePracticalOutputReserve(context, providerMaxOutputTokens));
}

export function computeLanguageModelTokenBudget(
	contextLength: number,
	providerMaxOutputTokens: number | undefined,
	fallbackMaxOutputTokens: number
): { maxInputTokens: number; maxOutputTokens: number } {
	const context = finitePositiveInteger(contextLength) ?? 1;
	const maxOutputTokens = Math.min(
		finitePositiveInteger(providerMaxOutputTokens) ?? finitePositiveInteger(fallbackMaxOutputTokens) ?? 1,
		PRACTICAL_MAX_OUTPUT_TOKENS
	);
	const maxInputTokens =
		computeAdvertisedMaxInputTokens(context, providerMaxOutputTokens) ?? Math.max(1, context - maxOutputTokens);
	return { maxInputTokens, maxOutputTokens };
}
