import assert from "assert/strict";

import {
	applyAnthropicModelConfiguration,
	applyOpenAIModelConfiguration,
	applyVertexModelConfiguration,
	buildInfiniAIModelConfigurationSchema,
	resolveInfiniAIModelConfiguration,
} from "./modelConfiguration";
import type { InfiniAIModelInfo } from "./types";

function modelInfo(overrides: Partial<InfiniAIModelInfo> = {}): InfiniAIModelInfo {
	return {
		id: "qwen3-32b",
		object: "model",
		created: 0,
		owned_by: "infiniai",
		maxOutputTokens: 8192,
		capabilities: {
			toolCalling: true,
		},
		...overrides,
	};
}

describe("model configuration schema", () => {
	it("creates token and unset-safe reasoning controls for every model", () => {
		const schema = buildInfiniAIModelConfigurationSchema(modelInfo(), 8192);

		assert.deepEqual(schema.properties.maxOutputTokens.enum, [0, 1024, 4096, 8192]);
		assert.deepEqual(schema.properties.maxOutputTokens.enumItemLabels, ["Model default", "1K", "4K", "8K"]);
		assert.equal(schema.properties.maxOutputTokens.default, 0);
		assert.equal(schema.properties.maxOutputTokens.group, "tokens");
		assert.deepEqual(schema.properties.reasoningEffort.enum, ["unset", "low", "medium", "high"]);
		assert.deepEqual(schema.properties.reasoningEffort.enumItemLabels, ["Unset", "Low", "Medium", "High"]);
		assert.match(schema.properties.reasoningEffort.description ?? "", /Selected values send reasoning_effort/);
		assert.doesNotMatch(schema.properties.reasoningEffort.description ?? "", /Best[- ]effort/i);
		assert.match(schema.properties.reasoningEffort.enumDescriptions?.[0] ?? "", /Do not send reasoning_effort/);
		assert.match(schema.properties.reasoningEffort.enumDescriptions?.[1] ?? "", /may ignore or reject/);
		assert.doesNotMatch(schema.properties.reasoningEffort.enumDescriptions?.join("\n") ?? "", /Best[- ]effort/i);
		assert.equal(schema.properties.reasoningEffort.default, "unset");
		assert.equal(schema.properties.reasoningEffort.group, "navigation");
		assert.deepEqual(schema.properties.thinkingMode.enum, ["unset", "disabled", "enabled"]);
		assert.deepEqual(schema.properties.thinkingMode.enumItemLabels, ["Empty", "Disabled", "Enabled"]);
		assert.doesNotMatch(schema.properties.thinkingMode.description ?? "", /provider[- ]specific/i);
		assert.doesNotMatch(schema.properties.thinkingMode.enumDescriptions?.join("\n") ?? "", /Best[- ]effort/i);
		assert.doesNotMatch(schema.properties.thinkingMode.enumDescriptions?.join("\n") ?? "", /provider[- ]specific/i);
		assert.equal(schema.properties.thinkingMode.default, "unset");
	});

	it("does not require reasoning metadata to expose unset-safe controls", () => {
		const schema = buildInfiniAIModelConfigurationSchema(
			modelInfo({
				capabilities: {
					toolCalling: true,
				},
			}),
			4096
		);

		assert.ok(schema.properties.maxOutputTokens);
		assert.deepEqual(schema.properties.reasoningEffort.enum, ["unset", "low", "medium", "high"]);
		assert.deepEqual(schema.properties.thinkingMode.enum, ["unset", "disabled", "enabled"]);
	});
});

describe("model configuration resolution", () => {
	it("reads modelConfiguration and ignores unknown or default values", () => {
		const result = resolveInfiniAIModelConfiguration({
			modelConfiguration: {
				maxOutputTokens: 2048,
				reasoningEffort: "high",
				thinkingMode: "disabled",
				unknown: "ignored",
			},
		} as any);

		assert.deepEqual(result, {
			maxOutputTokens: 2048,
			reasoningEffort: "high",
			thinkingMode: "disabled",
		});
	});

	it("reads fallback configuration and lets modelConfiguration win", () => {
		const result = resolveInfiniAIModelConfiguration({
			configuration: {
				maxOutputTokens: 1024,
				reasoningEffort: "low",
			},
			modelConfiguration: {
				reasoningEffort: "medium",
			},
		} as any);

		assert.deepEqual(result, {
			maxOutputTokens: 1024,
			reasoningEffort: "medium",
		});
	});

	it("drops invalid and unset/model-default values", () => {
		const result = resolveInfiniAIModelConfiguration({
			modelConfiguration: {
				maxOutputTokens: 0,
				reasoningEffort: "unset",
				thinkingMode: "unset",
			},
		} as any);

		assert.deepEqual(result, {});
	});

	it("keeps default as a backward-compatible unset alias", () => {
		const result = resolveInfiniAIModelConfiguration({
			modelConfiguration: {
				reasoningEffort: "default",
				thinkingMode: "default",
			},
		} as any);

		assert.deepEqual(result, {});
	});
});

describe("model configuration request mapping", () => {
	it("maps OpenAI-compatible configuration fields without raw passthrough", () => {
		const body: Record<string, unknown> = { model: "qwen3-32b" };

		applyOpenAIModelConfiguration(
			body,
			{
				maxOutputTokens: 2048,
				reasoningEffort: "high",
				thinkingMode: "disabled",
			}
		);

		const rawBody: Record<string, unknown> = body;
		assert.deepEqual(body, {
			model: "qwen3-32b",
			max_tokens: 2048,
			reasoning_effort: "high",
			enable_thinking: false,
			thinking: { type: "disabled" },
		});
		assert.equal(rawBody.maxOutputTokens, undefined);
		assert.equal(rawBody.reasoningEffort, undefined);
		assert.equal(rawBody.thinkingMode, undefined);
	});

	it("maps explicit thinking enablement when selected", () => {
		const body: Record<string, unknown> = { model: "kimi-k2-thinking" };

		applyOpenAIModelConfiguration(body, {
			thinkingMode: "enabled",
		});

		assert.deepEqual(body, {
			model: "kimi-k2-thinking",
			enable_thinking: true,
			thinking: { type: "enabled" },
		});
	});

	it("maps Anthropic configuration to max_tokens only", () => {
		const body: { max_tokens?: number } = {};

		applyAnthropicModelConfiguration(body, {
			maxOutputTokens: 4096,
			reasoningEffort: "high",
			thinkingMode: "disabled",
		});

		assert.deepEqual(body, { max_tokens: 4096 });
	});

	it("maps Vertex configuration under generationConfig only", () => {
		const body = { generationConfig: { maxOutputTokens: 1024 } };

		applyVertexModelConfiguration(body, {
			maxOutputTokens: 4096,
			reasoningEffort: "high",
			thinkingMode: "disabled",
		});

		assert.deepEqual(body, { generationConfig: { maxOutputTokens: 4096 } });
	});
});
