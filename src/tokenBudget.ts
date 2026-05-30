export const PRACTICAL_OUTPUT_RESERVE_TOKENS = 16384;
export const PRACTICAL_OUTPUT_RESERVE_CONTEXT_RATIO = 0.25;

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
	const maxOutputTokens = finitePositiveInteger(providerMaxOutputTokens) ?? finitePositiveInteger(fallbackMaxOutputTokens) ?? 1;
	const maxInputTokens =
		computeAdvertisedMaxInputTokens(context, providerMaxOutputTokens) ?? Math.max(1, context - maxOutputTokens);
	return { maxInputTokens, maxOutputTokens };
}
