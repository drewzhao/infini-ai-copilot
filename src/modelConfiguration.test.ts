import assert from "assert/strict";

import {
	applyAnthropicModelConfiguration,
	applyOpenAIModelConfiguration,
	applyVertexModelConfiguration,
	appendModelConfigurationSummaryToTooltip,
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
	it("creates token and unset-safe thinking controls without unsupported effort", () => {
		const schema = buildInfiniAIModelConfigurationSchema(modelInfo(), 8192);

		assert.deepEqual(schema.properties.maxOutputTokens.enum, [0, 1024, 4096, 8192]);
		assert.deepEqual(schema.properties.maxOutputTokens.enumItemLabels, ["Model default", "1K", "4K", "8K"]);
		assert.equal(schema.properties.maxOutputTokens.default, 0);
		assert.equal(schema.properties.maxOutputTokens.group, "tokens");
		assert.equal(schema.properties.reasoningEffort, undefined);
		assert.deepEqual(schema.properties.thinkingMode.enum, ["unset", "disabled", "enabled"]);
		assert.deepEqual(schema.properties.thinkingMode.enumItemLabels, ["Unset", "Disabled", "Enabled"]);
		assert.match(schema.properties.thinkingMode.description ?? "", /confirmed request parameter/);
		assert.doesNotMatch(schema.properties.thinkingMode.enumDescriptions?.join("\n") ?? "", /Best[- ]effort/i);
		assert.equal(schema.properties.thinkingMode.default, "unset");
	});

	it("uses the built-in DeepSeek Anthropic profile to expose supported controls", () => {
		const schema = buildInfiniAIModelConfigurationSchema(
			modelInfo({
				id: "deepseek-v3.2",
				capabilities: {
					toolCalling: true,
				},
			}),
			4096,
			"anthropic"
		);

		assert.ok(schema.properties.maxOutputTokens);
		assert.deepEqual(schema.properties.reasoningEffort.enum, ["unset", "low", "medium", "high"]);
		assert.deepEqual(schema.properties.thinkingMode.enum, ["unset", "disabled", "enabled"]);
	});

	it("uses DeepSeek V4 OpenAI-specific reasoning effort choices", () => {
		const schema = buildInfiniAIModelConfigurationSchema(
			modelInfo({
				id: "deepseek-v4-pro",
				capabilities: {
					toolCalling: true,
				},
			}),
			4096,
			"openai"
		);

		assert.ok(schema.properties.maxOutputTokens);
		assert.deepEqual(schema.properties.reasoningEffort.enum, ["unset", "high", "max"]);
		assert.deepEqual(schema.properties.reasoningEffort.enumItemLabels, ["Unset", "High", "Max"]);
		assert.deepEqual(schema.properties.thinkingMode.enum, ["unset", "disabled", "enabled"]);
	});

	it("uses GLM 5.2 OpenAI-specific reasoning effort choices", () => {
		const schema = buildInfiniAIModelConfigurationSchema(
			modelInfo({
				id: "glm-5.2",
				capabilities: {
					toolCalling: true,
				},
			}),
			131072,
			"openai"
		);

		assert.ok(schema.properties.maxOutputTokens);
		assert.deepEqual(schema.properties.reasoningEffort.enum, ["unset", "high", "max"]);
		assert.deepEqual(schema.properties.reasoningEffort.enumItemLabels, ["Unset", "High", "Max"]);
		assert.deepEqual(schema.properties.thinkingMode.enum, ["unset", "disabled", "enabled"]);
	});

	it("shows only the safe Anthropic disable control for DeepSeek V4 catalog routes", () => {
		const schema = buildInfiniAIModelConfigurationSchema(
			modelInfo({
				id: "deepseek-v4-pro",
				capabilities: {
					toolCalling: true,
				},
			}),
			4096,
			"anthropic"
		);

		assert.ok(schema.properties.maxOutputTokens);
		assert.equal(schema.properties.reasoningEffort, undefined);
		assert.deepEqual(schema.properties.thinkingMode.enum, ["unset", "disabled"]);
		assert.deepEqual(schema.properties.thinkingMode.enumItemLabels, ["Unset", "Disabled"]);
	});

	it("does not expose thinking or effort controls for forced DeepSeek R1", () => {
		const schema = buildInfiniAIModelConfigurationSchema(
			modelInfo({
				id: "deepseek-r1",
			}),
			4096,
			"openai"
		);

		assert.ok(schema.properties.maxOutputTokens);
		assert.equal(schema.properties.reasoningEffort, undefined);
		assert.equal(schema.properties.thinkingMode, undefined);
	});

	it("shows only the safe Anthropic disable control for manually routed Kimi K2", () => {
		const schema = buildInfiniAIModelConfigurationSchema(
			modelInfo({
				id: "kimi-k2.6",
				capabilities: {
					toolCalling: true,
				},
			}),
			4096,
			"anthropic"
		);

		assert.ok(schema.properties.maxOutputTokens);
		assert.equal(schema.properties.reasoningEffort, undefined);
		assert.deepEqual(schema.properties.thinkingMode.enum, ["unset", "disabled"]);
		assert.deepEqual(schema.properties.thinkingMode.enumItemLabels, ["Unset", "Disabled"]);
	});

	it("exposes only K3 reasoning effort levels on the OpenAI-compatible route", () => {
		const schema = buildInfiniAIModelConfigurationSchema(
			modelInfo({
				id: "kimi-k3",
				capabilities: {
					toolCalling: true,
				},
			}),
			131072,
			"openai"
		);

		assert.deepEqual(schema.properties.reasoningEffort.enum, ["unset", "low", "high", "max"]);
		assert.deepEqual(schema.properties.reasoningEffort.enumItemLabels, ["Unset", "Low", "High", "Max"]);
		assert.equal(schema.properties.thinkingMode, undefined);
	});

	it("does not expose thinking or effort controls for forced Kimi K2.7 Code", () => {
		const schema = buildInfiniAIModelConfigurationSchema(modelInfo({ id: "kimi-k2.7-code" }), 131072, "openai");

		assert.equal(schema.properties.reasoningEffort, undefined);
		assert.equal(schema.properties.thinkingMode, undefined);
	});

	it("shows Claude adaptive thinking controls without unproven effort controls", () => {
		const schema = buildInfiniAIModelConfigurationSchema(
			modelInfo({
				id: "claude-opus-4-6",
				capabilities: {
					toolCalling: true,
				},
			}),
			4096,
			"anthropic"
		);

		assert.ok(schema.properties.maxOutputTokens);
		assert.equal(schema.properties.reasoningEffort, undefined);
		assert.deepEqual(schema.properties.thinkingMode.enum, ["unset", "disabled", "enabled"]);
		assert.deepEqual(schema.properties.thinkingMode.enumItemLabels, ["Unset", "Disabled", "Enabled"]);
	});

	it("shows Claude budgeted-thinking controls for non-adaptive extended-thinking model IDs", () => {
		const schema = buildInfiniAIModelConfigurationSchema(
			modelInfo({
				id: "claude-sonnet-4-5-20250929",
				capabilities: {
					toolCalling: true,
				},
			}),
			4096,
			"anthropic"
		);

		assert.ok(schema.properties.maxOutputTokens);
		assert.equal(schema.properties.reasoningEffort, undefined);
		assert.deepEqual(schema.properties.thinkingMode.enum, ["unset", "disabled", "enabled"]);
		assert.deepEqual(schema.properties.thinkingMode.enumItemLabels, ["Unset", "Disabled", "Enabled"]);
	});

	it("does not expose thinking controls for unknown Claude Anthropic model IDs", () => {
		const schema = buildInfiniAIModelConfigurationSchema(
			modelInfo({
				id: "claude-future-experimental",
				capabilities: {
					toolCalling: true,
				},
			}),
			4096,
			"anthropic"
		);

		assert.ok(schema.properties.maxOutputTokens);
		assert.equal(schema.properties.reasoningEffort, undefined);
		assert.equal(schema.properties.thinkingMode, undefined);
	});

	it("exposes thinking mode and reasoning effort for confirmed MiMo OpenAI models", () => {
		const schema = buildInfiniAIModelConfigurationSchema(
			modelInfo({
				id: "mimo-v2.5-pro",
				capabilities: {
					toolCalling: true,
				},
			}),
			4096,
			"openai"
		);

		assert.ok(schema.properties.maxOutputTokens);
		assert.deepEqual(schema.properties.reasoningEffort.enum, ["unset", "low", "medium", "high"]);
		assert.deepEqual(schema.properties.thinkingMode.enum, ["unset", "disabled", "enabled"]);
	});

	it("shows only the safe disable control for unprobed MiMo OpenAI variants", () => {
		const schema = buildInfiniAIModelConfigurationSchema(
			modelInfo({
				id: "mimo-v2-flash",
				capabilities: {
					toolCalling: true,
				},
			}),
			4096,
			"openai"
		);

		assert.ok(schema.properties.maxOutputTokens);
		assert.equal(schema.properties.reasoningEffort, undefined);
		assert.deepEqual(schema.properties.thinkingMode.enum, ["unset", "disabled"]);
	});

	it("does not expose thinking controls for unknown profiles", () => {
		const schema = buildInfiniAIModelConfigurationSchema(
			modelInfo({
				id: "custom-frontier-model",
			}),
			4096
		);

		assert.ok(schema.properties.maxOutputTokens);
		assert.equal(schema.properties.thinkingMode, undefined);
	});

	it("can append a model-picker tooltip summary for configurable controls", () => {
		const schema = buildInfiniAIModelConfigurationSchema(modelInfo({ id: "deepseek-v3.2" }), 8192, "anthropic");

		const tooltip = appendModelConfigurationSummaryToTooltip("DeepSeek model", schema);

		assert.match(tooltip, /DeepSeek model/);
		assert.match(tooltip, /Configurable: Max output tokens, Reasoning effort, Thinking mode/);
		assert.equal(appendModelConfigurationSummaryToTooltip(tooltip, schema), tooltip);
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
		const body: Record<string, unknown> = { model: "deepseek-v4-pro" };

		applyOpenAIModelConfiguration(body, {
			maxOutputTokens: 2048,
			reasoningEffort: "high",
			thinkingMode: "disabled",
		});

		const rawBody: Record<string, unknown> = body;
		assert.deepEqual(body, {
			model: "deepseek-v4-pro",
			max_tokens: 2048,
			thinking: { type: "disabled" },
		});
		assert.equal(rawBody.maxOutputTokens, undefined);
		assert.equal(rawBody.reasoningEffort, undefined);
		assert.equal(rawBody.thinkingMode, undefined);
	});

	it("applies DeepSeek V4 default reasoning effort on replay-enabled OpenAI requests", () => {
		const body: Record<string, unknown> = { model: "deepseek-v4-pro" };

		applyOpenAIModelConfiguration(body, {}, undefined, {
			useDefaultReasoningEffort: true,
		});

		assert.deepEqual(body, {
			model: "deepseek-v4-pro",
			reasoning_effort: "high",
		});
	});

	it("maps DeepSeek V4 OpenAI max reasoning effort", () => {
		const body: Record<string, unknown> = { model: "deepseek-v4-pro" };

		applyOpenAIModelConfiguration(body, {
			reasoningEffort: "max",
		});

		assert.deepEqual(body, {
			model: "deepseek-v4-pro",
			reasoning_effort: "max",
		});
	});

	it("applies GLM 5.2 default max reasoning effort on replay-enabled OpenAI requests", () => {
		const body: Record<string, unknown> = { model: "glm-5.2" };

		applyOpenAIModelConfiguration(body, {}, undefined, {
			useDefaultReasoningEffort: true,
		});

		assert.deepEqual(body, {
			model: "glm-5.2",
			reasoning_effort: "max",
		});
	});

	it("maps GLM 5.2 OpenAI high reasoning effort", () => {
		const body: Record<string, unknown> = { model: "glm-5.2" };

		applyOpenAIModelConfiguration(body, {
			reasoningEffort: "high",
		});

		assert.deepEqual(body, {
			model: "glm-5.2",
			reasoning_effort: "high",
		});
	});

	it("removes GLM 5.2 reasoning effort when thinking is disabled", () => {
		const body: Record<string, unknown> = { model: "glm-5.2" };

		applyOpenAIModelConfiguration(
			body,
			{
				reasoningEffort: "max",
				thinkingMode: "disabled",
			},
			undefined,
			{
				useDefaultReasoningEffort: true,
			}
		);

		assert.deepEqual(body, {
			model: "glm-5.2",
			thinking: { type: "disabled" },
		});
	});

	it("does not send unsupported DeepSeek V4 OpenAI reasoning effort values", () => {
		const body: Record<string, unknown> = { model: "deepseek-v4-pro" };

		applyOpenAIModelConfiguration(body, {
			reasoningEffort: "low",
		});

		assert.deepEqual(body, {
			model: "deepseek-v4-pro",
		});
	});

	it("applies MiMo default reasoning effort on replay-enabled OpenAI requests", () => {
		const body: Record<string, unknown> = { model: "mimo-v2.5-pro" };

		applyOpenAIModelConfiguration(body, {}, undefined, {
			useDefaultReasoningEffort: true,
		});

		assert.deepEqual(body, {
			model: "mimo-v2.5-pro",
			reasoning_effort: "high",
		});
	});

	it("ignores unsupported OpenAI reasoning effort controls", () => {
		const body: Record<string, unknown> = { model: "qwen3-32b" };

		applyOpenAIModelConfiguration(body, {
			reasoningEffort: "high",
			thinkingMode: "disabled",
		});

		assert.deepEqual(body, {
			model: "qwen3-32b",
			enable_thinking: false,
		});
	});

	it("maps explicit thinking enablement when selected", () => {
		const body: Record<string, unknown> = { model: "kimi-k2.6" };

		applyOpenAIModelConfiguration(body, {
			thinkingMode: "enabled",
		});

		assert.deepEqual(body, {
			model: "kimi-k2.6",
			thinking: { type: "enabled" },
		});
	});

	it("applies Kimi K3 default max effort without adding a thinking object", () => {
		const body: Record<string, unknown> = { model: "kimi-k3" };

		applyOpenAIModelConfiguration(body, {}, undefined, {
			useDefaultReasoningEffort: true,
		});

		assert.deepEqual(body, {
			model: "kimi-k3",
			reasoning_effort: "max",
		});
	});

	it("maps explicit Kimi K3 effort and ignores unsupported thinking controls", () => {
		const body: Record<string, unknown> = { model: "kimi-k3" };

		applyOpenAIModelConfiguration(body, {
			reasoningEffort: "low",
			thinkingMode: "disabled",
		});

		assert.deepEqual(body, {
			model: "kimi-k3",
			reasoning_effort: "low",
		});
	});

	it("selects MiniMax split reasoning mode through the request policy", () => {
		const body: Record<string, unknown> = { model: "minimax-m2.7" };

		applyOpenAIModelConfiguration(body, {});

		assert.deepEqual(body, {
			model: "minimax-m2.7",
			reasoning_split: true,
		});
	});

	it("selects MiniMax split reasoning mode for future MiniMax OpenAI-compatible IDs", () => {
		const body: Record<string, unknown> = { model: "minimax-next" };

		applyOpenAIModelConfiguration(body, {});

		assert.deepEqual(body, {
			model: "minimax-next",
			reasoning_split: true,
		});
	});

	it("maps Anthropic DeepSeek effort and thinking controls", () => {
		const body: { model: string; max_tokens?: number; output_config?: { effort: string }; thinking?: unknown } = {
			model: "deepseek-v3.2",
			max_tokens: 2048,
		};

		applyAnthropicModelConfiguration(
			body,
			{
				maxOutputTokens: 4096,
				reasoningEffort: "high",
				thinkingMode: "enabled",
			},
			"deepseek-v3.2"
		);

		assert.deepEqual(body, {
			model: "deepseek-v3.2",
			max_tokens: 4096,
			output_config: { effort: "high" },
		});
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
