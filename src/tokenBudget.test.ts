import assert from "assert/strict";

import {
	computeAdvertisedMaxInputTokens,
	computeLanguageModelTokenBudget,
	computePracticalOutputReserve,
	PRACTICAL_MAX_OUTPUT_TOKENS,
} from "./tokenBudget";

describe("advertised prompt budget policy", () => {
	it("caps very large provider completion limits to a practical interactive reserve", () => {
		assert.equal(computeAdvertisedMaxInputTokens(204800, 131072), 188416);
		assert.equal(computeAdvertisedMaxInputTokens(1000000, 131072), 983616);
		assert.equal(computeAdvertisedMaxInputTokens(1024000, 393216), 1007616);
	});

	it("keeps smaller provider completion limits as the reserve", () => {
		assert.equal(computeAdvertisedMaxInputTokens(131072, 8192), 122880);
		assert.equal(computeAdvertisedMaxInputTokens(131072, 16384), 114688);
	});

	it("uses a practical reserve when the provider does not publish max completion tokens", () => {
		assert.equal(computeAdvertisedMaxInputTokens(262144, undefined), 245760);
	});

	it("bounds the reserve for small context windows", () => {
		assert.equal(computePracticalOutputReserve(8192, undefined), 2048);
		assert.equal(computeAdvertisedMaxInputTokens(8192, undefined), 6144);
	});

	it("separates fallback output caps from provider-published max completion", () => {
		assert.deepEqual(computeLanguageModelTokenBudget(262144, undefined, 4096), {
			maxInputTokens: 245760,
			maxOutputTokens: 4096,
		});
	});

	it("caps the advertised max output tokens at the practical completion cap", () => {
		// kimi-k3 shape: catalog publishes max_output_length equal to the whole
		// context window; without the cap the advertised sum is ~2x the window.
		assert.deepEqual(computeLanguageModelTokenBudget(1048576, 1048576, 4096), {
			maxInputTokens: 1032192,
			maxOutputTokens: PRACTICAL_MAX_OUTPUT_TOKENS,
		});
		const sum = 1032192 + PRACTICAL_MAX_OUTPUT_TOKENS;
		assert.ok(sum <= 1048576 * 1.02, `advertised sum ${sum} should stay near the real context window`);
	});

	it("keeps provider completion limits below the cap untouched", () => {
		assert.deepEqual(computeLanguageModelTokenBudget(262144, 16384, 4096), {
			maxInputTokens: 245760,
			maxOutputTokens: 16384,
		});
		assert.deepEqual(computeLanguageModelTokenBudget(262144, 32768, 4096), {
			maxInputTokens: 245760,
			maxOutputTokens: 32768,
		});
	});
});
