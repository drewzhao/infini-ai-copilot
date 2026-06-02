import assert from "assert/strict";

import { resolveReasoningDialectProfile } from "./reasoningDialect";
import {
	getDefaultRequestThinkingMode,
	shouldHonorThinkingRoundTripForProfile,
	shouldRequireThinkingReplayByProfile,
} from "./thinkingPolicy";

describe("profile-aware thinking policy", () => {
	it("honors the Kimi K2 round-trip default on the OpenAI-compatible route", () => {
		const profile = resolveReasoningDialectProfile({ modelId: "kimi-k2.6", transport: "openai" });

		assert.equal(shouldHonorThinkingRoundTripForProfile({ profile }), true);
		assert.equal(getDefaultRequestThinkingMode({ profile }), undefined);
	});

	it("does not apply the model-id Kimi K2 round-trip default to safe-off Anthropic routes", () => {
		const profile = resolveReasoningDialectProfile({ modelId: "kimi-k2.6", transport: "anthropic" });

		assert.equal(shouldHonorThinkingRoundTripForProfile({ profile }), false);
		assert.equal(
			shouldHonorThinkingRoundTripForProfile({
				profile,
				configuredThinkingMode: "disabled",
			}),
			false
		);
		assert.equal(
			shouldHonorThinkingRoundTripForProfile({
				profile,
				configuredThinkingMode: "enabled",
			}),
			false
		);
		assert.equal(getDefaultRequestThinkingMode({ profile }), "disabled");
	});

	it("does not apply the DeepSeek V4 round-trip default to safe-off Anthropic routes", () => {
		const profile = resolveReasoningDialectProfile({ modelId: "deepseek-v4-pro", transport: "anthropic" });

		assert.equal(shouldHonorThinkingRoundTripForProfile({ profile }), false);
		assert.equal(
			shouldHonorThinkingRoundTripForProfile({
				profile,
				configuredThinkingMode: "enabled",
			}),
			false
		);
		assert.equal(getDefaultRequestThinkingMode({ profile }), "disabled");
	});

	it("does not require replay when thinking is explicitly disabled", () => {
		const profile = resolveReasoningDialectProfile({ modelId: "claude-opus-4-6", transport: "anthropic" });

		assert.equal(
			shouldRequireThinkingReplayByProfile({
				profile,
				configuredThinkingMode: "disabled",
				forceDisableThinking: false,
			}),
			false
		);
		assert.equal(
			shouldRequireThinkingReplayByProfile({
				profile,
				configuredThinkingMode: "enabled",
				forceDisableThinking: false,
			}),
			true
		);
	});
});
