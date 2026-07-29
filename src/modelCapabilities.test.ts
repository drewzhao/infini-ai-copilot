import assert from "assert/strict";

import {
	resolveImageInputCapability,
	resolveToolCallingCapability,
	VERIFIED_TOOL_CALLING_MODEL_PATTERNS,
} from "./modelCapabilities";

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

	it("treats explicit vision: false as authoritative over name heuristics", () => {
		const result = resolveImageInputCapability({ id: "some-model-vision", vision: false });
		assert.equal(result, false);
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

describe("resolveToolCallingCapability", () => {
	it("uses explicit boolean and numeric metadata", () => {
		assert.equal(resolveToolCallingCapability({ id: "tools", capabilities: { toolCalling: true } }), true);
		assert.equal(resolveToolCallingCapability({ id: "no-tools", capabilities: { toolCalling: false } }), false);
		assert.equal(resolveToolCallingCapability({ id: "numeric", capabilities: { toolCalling: 1 } }), true);
		assert.equal(resolveToolCallingCapability({ id: "numeric-off", capabilities: { toolCalling: 0 } }), false);
	});

	it("defaults unknown models to no tool calling", () => {
		assert.equal(resolveToolCallingCapability({ id: "future-chat-model" }), false);
	});

	it("uses verified fallbacks only when metadata is silent", () => {
		assert.equal(
			resolveToolCallingCapability(
				{ id: "deepseek-v4-pro" },
				{ verifiedPatterns: VERIFIED_TOOL_CALLING_MODEL_PATTERNS }
			),
			true
		);
		assert.equal(
			resolveToolCallingCapability(
				{ id: "deepseek-v4-pro", capabilities: { toolCalling: false } },
				{ verifiedPatterns: VERIFIED_TOOL_CALLING_MODEL_PATTERNS }
			),
			false
		);
	});

	it("uses the exact verified Kimi K3 fallback without overriding stronger signals", () => {
		const config = { verifiedPatterns: VERIFIED_TOOL_CALLING_MODEL_PATTERNS };

		assert.equal(resolveToolCallingCapability({ id: "kimi-k3" }, config), true);
		assert.equal(resolveToolCallingCapability({ id: "kimi-k3-preview" }, config), false);
		assert.equal(resolveToolCallingCapability({ id: "kimi-k3", capabilities: { toolCalling: false } }, config), false);
		assert.equal(
			resolveToolCallingCapability(
				{ id: "kimi-k3", capabilities: { toolCalling: true } },
				{ ...config, disablePatterns: ["kimi-k3"] }
			),
			false
		);
	});

	it("supports explicit user enable and disable patterns with disable winning", () => {
		assert.equal(
			resolveToolCallingCapability(
				{ id: "future-chat-model", capabilities: { toolCalling: false } },
				{ enablePatterns: ["future-*"] }
			),
			true
		);
		assert.equal(
			resolveToolCallingCapability(
				{ id: "future-chat-model", capabilities: { toolCalling: true } },
				{ enablePatterns: ["future-*"], disablePatterns: ["*-model"] }
			),
			false
		);
	});
});
