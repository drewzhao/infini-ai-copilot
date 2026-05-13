import assert from "assert/strict";

import { DEFAULT_HIDDEN_MODEL_PATTERNS, isModelHiddenByVisibilityConfig } from "./modelVisibilityCore";

describe("isModelHiddenByVisibilityConfig", () => {
	it("hides default image and video generation model families by pattern", () => {
		const hidden = new Set<string>();
		const visible = new Set<string>();
		const ids = [
			"vidu-q1",
			"foo-seedream-v3",
			"seedance-lite",
			"image-generator",
			"stable-diffusion-xl",
			"hailuo-video",
			"kling-v2",
		];

		assert.deepEqual(
			ids.map(id => isModelHiddenByVisibilityConfig(id, hidden, visible, DEFAULT_HIDDEN_MODEL_PATTERNS)),
			[true, true, true, true, true, true, true]
		);
	});

	it("keeps normal chat models visible by default", () => {
		const result = isModelHiddenByVisibilityConfig(
			"deepseek-v4-chat",
			new Set<string>(),
			new Set<string>(),
			DEFAULT_HIDDEN_MODEL_PATTERNS
		);
		assert.equal(result, false);
	});

	it("lets exact visible overrides win over hidden IDs and patterns", () => {
		const result = isModelHiddenByVisibilityConfig(
			"kling-v2",
			new Set(["kling-v2"]),
			new Set(["kling-v2"]),
			DEFAULT_HIDDEN_MODEL_PATTERNS
		);
		assert.equal(result, false);
	});

	it("supports exact provider-level hidden IDs", () => {
		const result = isModelHiddenByVisibilityConfig(
			"custom-chat-model",
			new Set(["custom-chat-model"]),
			new Set<string>(),
			[]
		);
		assert.equal(result, true);
	});
});
