import assert from "assert/strict";

import {
	enrichModelWithBuiltInMetadata,
	getBuiltInInfiniAIModelMetadata,
	inferModelFamily,
	isBuiltInNonChatModel,
} from "./catalogMetadata";
import type { InfiniAIModelInfo } from "./types";

function liveModel(id: string, overrides: Partial<InfiniAIModelInfo> = {}): InfiniAIModelInfo {
	return {
		id,
		object: "model",
		created: 1,
		owned_by: "live",
		...overrides,
	};
}

describe("built-in InfiniAI catalog metadata", () => {
	it("enriches known Claude-compatible models without overriding live fields", () => {
		const enriched = enrichModelWithBuiltInMetadata(
			liveModel("deepseek-v4-pro", {
				apiMode: "openai",
				max_tokens: 123,
				capabilities: { toolCalling: true },
			})
		);

		assert.equal(enriched.family, "deepseek-v4");
		assert.equal(enriched.apiMode, "openai");
		assert.equal(enriched.endpointKind, "messages");
		assert.equal(enriched.max_tokens, 123);
		assert.equal(enriched.context_length, 1024000);
		assert.equal(enriched.capabilities?.toolCalling, true);
		assert.match(enriched.detail ?? "", /Claude-compatible/);
	});

	it("fills picker and capability metadata for known multimodal models", () => {
		const enriched = enrichModelWithBuiltInMetadata(liveModel("kimi-k2.6"));

		assert.equal(enriched.displayName, "kimi-k2.6");
		assert.equal(enriched.family, "kimi-k2");
		assert.equal(enriched.apiMode, "anthropic");
		assert.equal(enriched.endpointKind, "messages");
		assert.equal(enriched.max_tokens, 131072);
		assert.equal(enriched.vision, true);
		assert.deepEqual(enriched.input_modalities, ["text", "image"]);
		assert.equal(enriched.capabilities?.toolCalling, true);
		assert.equal(enriched.capabilities?.imageInput, true);
	});

	it("defaults GLM models to the OpenClaw Z.AI OpenAI-compatible protocol", () => {
		for (const id of ["glm-4.5", "glm-4.5-air", "glm-4.6", "glm-4.7", "glm-5", "glm-5.1", "glm-5.2"]) {
			const enriched = enrichModelWithBuiltInMetadata(liveModel(id));

			assert.equal(enriched.apiMode, "openai", id);
			assert.equal(enriched.endpointKind, "chat.completions", id);
			assert.doesNotMatch(enriched.detail ?? "", /Claude-compatible/, id);
			assert.doesNotMatch(enriched.tooltip ?? "", /Endpoint: Claude兼容/, id);
		}
	});

	it("marks built-in non-chat catalog entries", () => {
		assert.equal(isBuiltInNonChatModel("bge-m3"), true);
		assert.equal(isBuiltInNonChatModel("bge-reranker-v2-m3"), true);
		assert.equal(isBuiltInNonChatModel("seedance-1.0"), true);
		assert.equal(isBuiltInNonChatModel("deepseek-v4-pro"), false);
	});

	it("does not turn missing tool scene tags into hard tool-calling negatives", () => {
		assert.equal(getBuiltInInfiniAIModelMetadata("deepseek-v4-pro")?.capabilities?.toolCalling, undefined);
		assert.equal(getBuiltInInfiniAIModelMetadata("deepseek-v4-flash")?.capabilities?.toolCalling, undefined);
		assert.equal(getBuiltInInfiniAIModelMetadata("mimo-v2-pro")?.capabilities?.toolCalling, undefined);
		assert.equal(getBuiltInInfiniAIModelMetadata("mimo-v2.5-pro")?.capabilities?.toolCalling, undefined);
	});

	it("uses a practical output reserve for VS Code prompt budgets", () => {
		const cases: Array<[string, number]> = [
			["glm-5.2", 983616],
			["glm-5.1", 188416],
			["glm-5", 188416],
			["kimi-k2.6", 245760],
			["deepseek-v4-pro", 1007616],
			["deepseek-v4-flash", 1007616],
			["kimi-k2.5", 245760],
			["mimo-v2-pro", 245760],
			["mimo-v2.5-pro", 245760],
			["qwen3-14b", 122880],
			["deepseek-v3", 114688],
		];

		for (const [id, expectedMaxInputTokens] of cases) {
			assert.equal(getBuiltInInfiniAIModelMetadata(id)?.maxInputTokens, expectedMaxInputTokens, id);
		}
	});

	it("records GLM 5.2 million-token metadata", () => {
		const metadata = getBuiltInInfiniAIModelMetadata("glm-5.2");

		assert.equal(metadata?.family, "glm-5");
		assert.equal(metadata?.maxContextTokens, 1000000);
		assert.equal(metadata?.maxInputTokens, 983616);
		assert.equal(metadata?.maxOutputTokens, 131072);
		assert.equal(metadata?.apiMode, "openai");
		assert.equal(metadata?.endpointKind, "chat.completions");
		assert.match(metadata?.tooltip ?? "", /Context: 1,000,000 tokens/);
	});

	it("keeps a useful family for unknown models", () => {
		assert.equal(getBuiltInInfiniAIModelMetadata("unknown-model"), undefined);
		assert.equal(enrichModelWithBuiltInMetadata(liveModel("unknown-model")).family, "unknown-model");
		assert.equal(inferModelFamily("qwen3-next-80b-a3b-thinking"), "qwen3-next");
	});
});
