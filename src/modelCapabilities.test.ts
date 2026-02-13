import assert from "assert/strict";

import { resolveImageInputCapability } from "./modelCapabilities";

describe("resolveImageInputCapability", () => {
	it("returns false when disablePatterns matches (even if metadata says vision)", () => {
		const result = resolveImageInputCapability(
			{ id: "kimi-k2.5", vision: true },
			{ disablePatterns: ["kimi-k2.5"], enablePatterns: ["kimi-k2.5"] }
		);
		assert.equal(result, false);
	});

	it("returns true when enablePatterns matches (wildcards supported)", () => {
		const result = resolveImageInputCapability({ id: "kimi-k2.5" }, { enablePatterns: ["kimi-*"] });
		assert.equal(result, true);
	});

	it("returns true when model has explicit vision: true", () => {
		const result = resolveImageInputCapability({ id: "some-model", vision: true });
		assert.equal(result, true);
	});

	it("returns true when architecture.input_modalities includes image", () => {
		const result = resolveImageInputCapability({
			id: "some-model",
			architecture: { input_modalities: ["text", "image"] },
		});
		assert.equal(result, true);
	});

	it("falls back to name heuristic (-vision / -vl- / glm*v)", () => {
		assert.equal(resolveImageInputCapability({ id: "foo-vision" }), true);
		assert.equal(resolveImageInputCapability({ id: "bar-vl-1" }), true);
		assert.equal(resolveImageInputCapability({ id: "glm4.6v" }), true);
	});

	it("returns false when no signals match", () => {
		const result = resolveImageInputCapability({ id: "text-only-model" });
		assert.equal(result, false);
	});
});

