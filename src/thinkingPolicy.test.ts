import assert from "assert/strict";

import { resolveReasoningDialectProfile } from "./reasoningDialect";
import {
	getDefaultRequestThinkingMode,
	shouldCaptureDisabledThinkingObservation,
	shouldHonorThinkingRoundTripForProfile,
	shouldRequireThinkingReplayByProfile,
} from "./thinkingPolicy";

describe("profile-aware thinking policy", () => {
	it("honors the Kimi K2 round-trip default on the OpenAI-compatible route", () => {
		const profile = resolveReasoningDialectProfile({ modelId: "kimi-k2.6", transport: "openai" });

		assert.equal(shouldHonorThinkingRoundTripForProfile({ profile }), true);
		assert.equal(shouldHonorThinkingRoundTripForProfile({ profile, configuredThinkingMode: "disabled" }), false);
		assert.equal(getDefaultRequestThinkingMode({ profile }), undefined);
		assert.equal(
			shouldRequireThinkingReplayByProfile({
				profile,
				forceDisableThinking: false,
			}),
			false
		);
	});

	it("captures disabled K2.6 turns so thinking can be re-enabled later", () => {
		const profile = resolveReasoningDialectProfile({ modelId: "kimi-k2.6", transport: "openai" });

		assert.equal(
			shouldCaptureDisabledThinkingObservation({
				profile,
				configuredThinkingMode: "disabled",
				forceDisableThinking: false,
				allowThinkingRoundTrip: false,
			}),
			true
		);
		assert.equal(
			shouldCaptureDisabledThinkingObservation({
				profile,
				forceDisableThinking: true,
				allowThinkingRoundTrip: false,
			}),
			true
		);
		assert.equal(
			shouldCaptureDisabledThinkingObservation({
				profile,
				forceDisableThinking: true,
				allowThinkingRoundTrip: true,
			}),
			false
		);
	});

	it("captures explicitly disabled GLM-5.2 tool turns as observed-empty candidates", () => {
		const profile = resolveReasoningDialectProfile({ modelId: "glm-5.2", transport: "openai" });

		assert.equal(profile.replayScope, "tool-call-assistant-messages");
		assert.equal(
			shouldCaptureDisabledThinkingObservation({
				profile,
				configuredThinkingMode: "disabled",
				forceDisableThinking: false,
				allowThinkingRoundTrip: false,
			}),
			true
		);
	});

	it("always requires preserved replay for forced Kimi K2.7 and K3 profiles", () => {
		for (const modelId of ["kimi-k2.7-code", "kimi-k3"]) {
			const profile = resolveReasoningDialectProfile({ modelId, transport: "openai" });

			assert.equal(shouldHonorThinkingRoundTripForProfile({ profile }), true, modelId);
			assert.equal(
				shouldRequireThinkingReplayByProfile({
					profile,
					configuredThinkingMode: "disabled",
					forceDisableThinking: false,
				}),
				true,
				modelId
			);
		}
	});

	it("does not honor round-trip patterns for unverified Kimi variants", () => {
		const profile = resolveReasoningDialectProfile({ modelId: "kimi-k2.7-code-test", transport: "openai" });

		assert.equal(profile.replayRisk, "unknown");
		assert.equal(shouldHonorThinkingRoundTripForProfile({ profile }), false);
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
