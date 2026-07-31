import assert from "assert/strict";

import {
	applyExactToolCallingOverride,
	isExactToolCallingPattern,
	matchingToolCallingPatterns,
} from "./agentEligibility";

describe("Agent eligibility overrides", () => {
	it("adds an exact enable and removes an exact disable", () => {
		assert.deepEqual(
			applyExactToolCallingOverride(
				{ enable: ["other", "other"], disable: ["model-a", "blocked-*"] },
				"model-a",
				"enabled"
			),
			{ enable: ["other", "model-a"], disable: ["blocked-*"] }
		);
	});

	it("adds an exact disable and removes an exact enable", () => {
		assert.deepEqual(
			applyExactToolCallingOverride({ enable: ["model-a", "family-*"], disable: [] }, "model-a", "disabled"),
			{ enable: ["family-*"], disable: ["model-a"] }
		);
	});

	it("returns an exact model to automatic without changing wildcard patterns", () => {
		assert.deepEqual(
			applyExactToolCallingOverride(
				{ enable: ["model-a", "family-*"], disable: ["model-a", "blocked-*"] },
				"model-a",
				"automatic"
			),
			{ enable: ["family-*"], disable: ["blocked-*"] }
		);
	});

	it("reports exact and wildcard patterns that affect a model", () => {
		assert.deepEqual(matchingToolCallingPatterns("family-model-a", ["other", "family-*", "family-model-a"]), [
			"family-*",
			"family-model-a",
		]);
	});

	it("treats exact model IDs case-insensitively like capability matching", () => {
		assert.equal(isExactToolCallingPattern("kimi-k3", "KIMI-K3"), true);
		assert.equal(isExactToolCallingPattern("kimi-k3", "kimi-*"), false);
		assert.deepEqual(
			applyExactToolCallingOverride({ enable: ["KIMI-K3", "KIMI-K3"], disable: [] }, "kimi-k3", "automatic"),
			{ enable: [], disable: [] }
		);
	});
});
