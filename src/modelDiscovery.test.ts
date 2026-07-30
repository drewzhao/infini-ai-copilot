import assert from "assert/strict";

import {
	classifyInfiniAIModelType,
	formatInfiniAIModelType,
	normalizeInfiniAIModelsResponse,
	resolveInfiniAIModelVersion,
	selectInfiniAIChatModels,
} from "./modelDiscovery";
import type { InfiniAIModelInfo } from "./types";

function modelRow(id: string, modelType: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id,
		object: "model",
		created: 0,
		owned_by: "",
		max_output_length: 131072,
		context_length: 262144,
		model_type: modelType,
		...overrides,
	};
}

describe("InfiniAI model discovery", () => {
	it("validates and normalizes the live list response", () => {
		const normalized = normalizeInfiniAIModelsResponse({
			object: "list",
			data: [
				modelRow(" model-a ", "大语言模型", {
					created: -1,
					owned_by: " InfiniAI ",
					max_output_length: 131072.9,
					context_length: 262144.9,
				}),
				modelRow("model-b", "多模态模型", {
					max_output_length: 0,
					context_length: 0,
				}),
				modelRow("model-a", "大语言模型"),
				modelRow("", "大语言模型"),
				modelRow("not-a-model", "大语言模型", { object: "other" }),
			],
		});

		assert.equal(normalized.ok, true);
		if (!normalized.ok) {
			return;
		}
		assert.equal(normalized.value.rawModelCount, 5);
		assert.equal(normalized.value.models.length, 2);
		assert.equal(normalized.value.duplicateModelCount, 1);
		assert.equal(normalized.value.malformedModelCount, 2);

		const [first, second] = normalized.value.models;
		assert.equal(first.id, "model-a");
		assert.equal(first.created, 0);
		assert.equal(first.owned_by, "InfiniAI");
		assert.equal(first.context_length, 262144);
		assert.equal(first.max_output_length, 131072);
		assert.equal(first.max_tokens, 131072);
		assert.equal(first.maxOutputTokens, 131072);

		assert.equal(second.context_length, undefined);
		assert.equal(second.max_output_length, undefined);
		assert.equal(second.max_tokens, undefined);
		assert.equal(second.maxOutputTokens, undefined);
	});

	it("accepts the validated legacy nested list envelope", () => {
		const normalized = normalizeInfiniAIModelsResponse({
			code: 0,
			data: {
				object: "list",
				data: [modelRow("model-a", "大语言模型")],
			},
		});

		assert.equal(normalized.ok, true);
		if (normalized.ok) {
			assert.deepEqual(
				normalized.value.models.map((model) => model.id),
				["model-a"]
			);
		}
	});

	it("normalizes explicit image-input capability flags", () => {
		const normalized = normalizeInfiniAIModelsResponse({
			object: "list",
			data: [
				modelRow("vision-on", "多模态模型", { supports_image_in: true }),
				modelRow("vision-off", "多模态模型", { supports_image_in: false }),
				modelRow("vision-invalid", "多模态模型", { supports_image_in: "true" }),
			],
		});

		assert.equal(normalized.ok, true);
		if (normalized.ok) {
			assert.deepEqual(
				normalized.value.models.map((model) => model.supports_image_in),
				[true, false, undefined]
			);
		}
	});

	it("rejects envelopes that do not identify an InfiniAI model list", () => {
		const normalized = normalizeInfiniAIModelsResponse({
			data: [modelRow("model-a", "大语言模型")],
		});

		assert.deepEqual(normalized, {
			ok: false,
			error: 'Unexpected models response structure: expected object "list" with a data array',
		});
	});

	it("selects only known chat categories and reports filtered categories", () => {
		const models = [
			modelRow("llm", "大语言模型"),
			modelRow("multimodal", "多模态模型"),
			modelRow("image", "生图大模型"),
			modelRow("video", "视频大模型"),
			modelRow("embedding", "向量模型"),
			modelRow("reranker", "重排序模型"),
			modelRow("future", "未来模型"),
		] as unknown as InfiniAIModelInfo[];

		const selected = selectInfiniAIChatModels(models);

		assert.deepEqual(
			selected.models.map((model) => model.id),
			["llm", "multimodal"]
		);
		assert.equal(selected.nonChatModelCount, 4);
		assert.equal(selected.unknownModelTypeCount, 1);
		assert.equal(selected.liveOutputLimitCount, 2);
	});

	it("classifies and labels model types without inferring input modality", () => {
		assert.equal(classifyInfiniAIModelType("大语言模型"), "chat");
		assert.equal(classifyInfiniAIModelType("多模态模型"), "chat");
		assert.equal(classifyInfiniAIModelType("生图大模型"), "non-chat");
		assert.equal(classifyInfiniAIModelType(undefined), "unknown");
		assert.equal(formatInfiniAIModelType("多模态模型"), "Multimodal model");
		assert.equal(formatInfiniAIModelType("未来模型"), "未来模型");
	});

	it("does not expose placeholder creation values as model versions", () => {
		assert.equal(resolveInfiniAIModelVersion({ created: 0 }), "1.0.0");
		assert.equal(resolveInfiniAIModelVersion({ created: 1720000000 }), "1720000000");
		assert.equal(resolveInfiniAIModelVersion({ created: 0, version: " current " }), "current");
	});
});
