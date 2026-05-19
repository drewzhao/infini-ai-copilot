# InfiniAI Thinking Parameter Control and Replay Diagnosis

Date: 2026-05-19

## Executive Summary

The extension has outgrown its current thinking-parameter design.

The prominent failure mode is still the same protocol-level problem: when a model emits hidden reasoning during a tool-call assistant turn, later requests may need to replay the exact reasoning content with that assistant turn. If the extension sends assistant tool-call history without the required reasoning field, some upstream APIs return HTTP 400.

The newer diagnosis is broader: the extension currently treats thinking as a generic product toggle, while the actual API surface is dialect-specific by model family and transport.

The current code has three partially overlapping systems:

1. A generic user-facing `thinkingMode` model configuration.
2. A safety list that force-disables thinking for selected model IDs.
3. A replay store that captures and injects reasoning only when a model is explicitly opted into round-trip mode.

Those pieces are individually useful, but they do not yet compose into a safe reasoning protocol layer.

The required redesign is a model/profile-driven reasoning layer. It must decide, for each request:

- which transport is being used,
- which provider dialect the model speaks,
- whether thinking is default-on, default-off, forced, or unknown,
- which current-turn control field is valid,
- which replay field must be preserved,
- which preservation flag must be sent, and
- whether local replay data is sufficient before sending the request.

The extension should not normalize all models into:

```json
{
  "enable_thinking": false,
  "thinking": { "type": "disabled" }
}
```

That shape is not a universal protocol.

## Evidence Base

This report is based on the current local source snapshot:

```text
/Users/yinghaozhao/code/github/zenmux-copilot
branch: infini-ai-copilot
commit: 85d9682 Fix Anthropic thinking replay
```

The source tree was not modified during the diagnosis. A no-emit TypeScript check passed:

```bash
npm run compile -- --noEmit
```

The protocol model comes from the probe design and previous probe work in:

```text
/Users/yinghaozhao/code/github-yinghao/multibrand-docs/tools/api-probes/chat-completions/reasoning/design-implementation.md
```

That probe design is important because it records the core rule the extension should follow: request construction must preserve provider-native wire shapes. The probe design explicitly says the runner must not normalize provider fields into one invented `reasoning=true` abstraction. It also records the replay field mapping:

```text
DeepSeek: messages[].reasoning_content
GLM: messages[].reasoning_content + thinking.clear_thinking
Kimi: messages[].reasoning_content + thinking.keep
MiMo: messages[].reasoning_content
MiniMax split mode: messages[].reasoning_details
MiniMax native mode: messages[].content containing <think>...</think>
Qwen preserve-thinking models: messages[].reasoning_content + preserve_thinking
```

## Protocol Facts From Probe Work

### Fact 1: Thinking controls are not portable across model families

The probe design records these current Chat Completions dialects:

- DeepSeek uses `thinking.type` and may use `reasoning_effort`; output carrier is `reasoning_content`.
- GLM uses `thinking.type`; preserved thinking uses `thinking.clear_thinking`.
- Kimi uses `thinking.type`; preserved thinking uses `thinking.keep`.
- MiniMax uses `reasoning_split` to change output carrier; no confirmed thinking-off parameter exists for `minimax-m2.7`.
- MiMo uses `thinking.type`; output carrier is `reasoning_content`.
- Qwen uses top-level `enable_thinking`; output carrier is `reasoning_content` when visible.
- Qwen-VL needs multimodal request fixtures and cannot be treated as plain text Qwen for every probe.

Rationale: a field accepted by one model family can be ignored or rejected by another. Even when two families accept the same field name, the meaning can differ.

### Fact 2: Default thinking behavior must be treated as behavior, not as a pass/fail assertion

The probe design treats default behavior probes as observations. For example, a default request may produce visible reasoning content, no visible reasoning content, or transport-specific usage evidence. The extension should use this information to build safety policy, not to declare a universal pass/fail result.

Important known defaults from the current probe knowledge:

- GLM-5.1, GLM-5, and GLM-4.7 default to thinking enabled.
- Kimi K2.6 and Kimi K2.5 default to thinking enabled; `kimi-k2-thinking` is a dedicated thinking model.
- Qwen smaller open hybrid models show visible reasoning in streaming mode; thinking-suffixed Qwen models expose reasoning by default.
- MiMo supports `thinking.type` enabled/disabled.
- MiniMax M2.7 does not have a confirmed thinking-off parameter.

### Fact 3: Replay is provider-native

The probe design separates current-turn controls from replay behavior. A current-turn disable flag does not replace replay controls such as:

- GLM `thinking.clear_thinking`
- Kimi `thinking.keep`
- Qwen `preserve_thinking`
- provider-required assistant reasoning fields in `messages[]`

This distinction matters for VS Code extension logic. A request can be "thinking disabled now" and still contain prior assistant tool-call history that needs replay fields or explicit clearing behavior.

## Current Extension Architecture

### Request construction path

OpenAI-compatible requests flow through:

- `src/provider.ts`
  - `runOpenAIRequest(...)`
- `src/openai/openaiApi.ts`
  - `convertMessages(...)`
  - `prepareRequestBody(...)`
  - `processStreamingResponse(...)`
- `src/modelConfiguration.ts`
  - `resolveInfiniAIModelConfiguration(...)`
  - `applyOpenAIModelConfiguration(...)`
- `src/thinkingMode.ts`
  - safety patterns
  - round-trip opt-in patterns
  - `applyDisableThinking(...)`
- `src/thinkingReplay.ts`
  - OpenAI-compatible replay injection
  - Anthropic replay injection
- `src/thinkingReplayStore.ts`
  - replay cache storage and lookup

Anthropic-compatible requests flow through:

- `src/provider.ts`
  - `runAnthropicRequest(...)`
- `src/anthropic/anthropicApi.ts`
  - `convertMessages(...)`
  - `prepareRequestBody(...)`
  - `processStreamingResponse(...)`

### Existing replay store

The extension already has a useful replay store:

- `src/thinkingReplayStore.ts`
  - `ThinkingReplayStore`
  - `LocalPlaintextThinkingReplayStorage`
  - `MemoryThinkingReplayStorage`
- `src/extension.ts`
  - initializes `thinkingReplayStore`
  - supports `localPlaintext` and `memory`
  - registers `infiniai.clearThinkingReplayCache`

This is a good foundation. The main remaining problem is not storage mechanics; it is policy and dialect resolution.

## Findings

### Finding 1: The user-facing `thinkingMode` control is too generic

Current code:

- `src/modelConfiguration.ts:131` defines a generic `"Thinking mode"` property for every model.
- `src/modelConfiguration.ts:135` exposes `["unset", "disabled", "enabled"]`.
- `src/modelConfiguration.ts:158` maps `disabled` through `applyDisableThinking(...)`.
- `src/modelConfiguration.ts:160` maps `enabled` to both:

```ts
body.enable_thinking = true;
body.thinking = { type: "enabled" };
```

Proof:

```text
src/modelConfiguration.ts:131-143
src/modelConfiguration.ts:148-164
src/modelConfiguration.test.ts:131-164
```

Why this is wrong:

- Qwen-native current-turn control is top-level `enable_thinking`.
- GLM/Kimi/MiMo current-turn control is `thinking.type`.
- GLM/Kimi also need preservation flags for replay.
- MiniMax does not currently have a confirmed thinking-off parameter.
- Anthropic Messages uses a different `thinking` object shape.

Impact:

The UI suggests a stable, generic feature that does not exist at the wire level. A user can select `Enabled` or `Disabled` and the extension may send a mixed request body containing both Qwen-style and GLM/MiMo-style fields.

Suggested change:

Replace generic `thinkingMode` with a profile-derived capability surface. The UI should only expose controls valid for the selected model profile.

Implementation instruction:

1. Add a profile resolver, for example `src/reasoningDialect.ts`.
2. Define per-profile current-turn controls:

```ts
type CurrentTurnThinkingControl =
	| { kind: "none" }
	| { kind: "qwen-enable-thinking"; enabled: boolean }
	| { kind: "thinking-type"; type: "enabled" | "disabled" }
	| { kind: "anthropic-thinking"; type: "enabled" | "disabled" | "adaptive"; budgetTokens?: number };
```

3. Build the model configuration schema from the resolved profile.
4. Do not show a generic on/off control for forced-thinking models or for profiles without a confirmed disable control.

### Finding 2: `applyDisableThinking(...)` sends Chat Completions fields into Anthropic Messages requests

Current code:

- `src/thinkingMode.ts:150` sets `rb.enable_thinking = false`.
- `src/thinkingMode.ts:152` sets `rb.thinking = { type: "disabled" }`.
- `src/provider.ts:765` calls `applyDisableThinking(...)` on an Anthropic request body when `suppressResponseThinking` is true.

Proof:

```text
src/thinkingMode.ts:144-153
src/provider.ts:758-767
src/anthropic/anthropicTypes.ts:75-85
```

The Anthropic request type currently declares:

```ts
thinking?: {
	type: "enabled";
	budget_tokens: number;
};
```

It does not declare top-level `enable_thinking`. It also does not declare `thinking.type: "disabled"` or `thinking.type: "adaptive"` even though the modern Anthropic-compatible API surface may include those shapes.

Why this is wrong:

Anthropic Messages is a different transport. A Chat Completions gateway candidate field such as top-level `enable_thinking` should not be blindly added to Anthropic Messages request bodies.

Impact:

For catalog-routed Anthropic-compatible models, the extension may send invalid, ignored, or misleading request fields. The catalog routes several reasoning-sensitive models through Anthropic Messages:

```text
src/generated/infiniaiCatalogMetadata.generated.ts:247-264   deepseek-v4-pro
src/generated/infiniaiCatalogMetadata.generated.ts:353-408   glm-4.7 / glm-5 / glm-5.1
src/generated/infiniaiCatalogMetadata.generated.ts:445-482   kimi-k2.5 / kimi-k2.6
src/generated/infiniaiCatalogMetadata.generated.ts:501-534   mimo-v2-pro / mimo-v2.5-pro
src/generated/infiniaiCatalogMetadata.generated.ts:535-587   minimax-m2.1 / m2.5 / m2.7
```

Suggested change:

Split disable logic by transport and dialect:

- OpenAI Chat Completions Qwen profile: `enable_thinking: false`.
- OpenAI Chat Completions GLM/Kimi/MiMo/DeepSeek profile: `thinking: { type: "disabled" }`.
- Anthropic Messages profile: use only fields valid for the Anthropic-compatible endpoint.
- MiniMax: do not claim disable support until a probe proves a working field.

Implementation instruction:

Replace `applyDisableThinking(body)` with:

```ts
applyReasoningControl({
	body,
	transport,
	profile,
	currentTurnPreference,
	replayPolicy,
});
```

This function should refuse to write fields that are not valid for the selected `transport + profile`.

### Finding 3: Replay capture is gated behind explicit round-trip opt-in, but several models think by default

Current code:

- `src/provider.ts:629-640` computes `replayDecision`.
- `src/provider.ts:644` uses replay-injected messages only when `replayDecision.allowThinkingRoundTrip` is true.
- `src/provider.ts:645-647` starts a pending replay turn only when `allowThinkingRoundTrip` is true.
- The Anthropic path repeats the same pattern at `src/provider.ts:729-747`.

Proof:

```text
src/provider.ts:626-669
src/provider.ts:723-764
```

Why this is wrong:

The current code only captures replay data when the user explicitly opts into round-trip mode. But some models can emit reasoning by default. For example, probe knowledge says GLM-5.1 / GLM-5 / GLM-4.7 default to thinking enabled. Kimi K2.6 / Kimi K2.5 also default to thinking enabled. Qwen thinking-suffixed models expose reasoning by default.

If the first tool-call turn thinks by default and the extension does not start a pending replay turn, the extension has no exact reasoning content to inject later.

Impact:

This creates the classic 400 path:

1. Request 1 is sent without an explicit thinking control or with a default-thinking model.
2. The model emits reasoning and tool calls.
3. The extension does not capture replay content because `allowThinkingRoundTrip` is false.
4. Request 2 contains assistant tool-call history but no required reasoning field.
5. The API rejects the request with HTTP 400.

Suggested change:

Separate capture policy from user opt-in.

The extension should start capture whenever the effective request may produce structured reasoning that can later be required for replay. That includes default-thinking and forced-thinking profiles.

Implementation instruction:

Introduce two independent decisions:

```ts
const effectiveThinking = resolveEffectiveThinking(profile, userPreference);
const replayPolicy = resolveReplayPolicy(profile, effectiveThinking, messageHistory);
```

Where:

- `effectiveThinking` answers whether the current request can produce reasoning.
- `replayPolicy` answers whether to capture, inject, clear, keep, fail locally, or skip.

Do not use `enableThinkingRoundTripForModels` as the only gate for starting capture.

### Finding 4: Replay injection normalizes too many provider shapes into `reasoning_content`

Current code:

- `src/thinkingReplay.ts:30-89` injects `reasoning_content` into OpenAI-compatible assistant messages.
- `src/thinkingReplay.ts:112-199` injects Anthropic `thinking` blocks.

Proof:

```text
src/thinkingReplay.ts:30-89
src/thinkingReplay.ts:112-199
src/openai/openaiTypes.ts:23-32
src/anthropic/anthropicTypes.ts:29-46
```

Why this is incomplete:

The probe design records more replay carriers:

```text
DeepSeek: messages[].reasoning_content
GLM: messages[].reasoning_content + thinking.clear_thinking
Kimi: messages[].reasoning_content + thinking.keep
MiMo: messages[].reasoning_content
MiniMax split mode: messages[].reasoning_details
MiniMax native mode: messages[].content containing <think>...</think>
Qwen preserve-thinking models: messages[].reasoning_content + preserve_thinking
```

Impact:

For MiniMax split mode, the current replay store can capture `reasoning_details` text from a stream, but later replay would use `reasoning_content`, which is the wrong input field. For GLM and Kimi, the current code can inject `reasoning_content`, but it does not send the provider preservation flag.

Suggested change:

Store and replay provider-native carriers, not just normalized text.

Implementation instruction:

Extend `ThinkingReplayEntry`:

```ts
interface ThinkingReplayEntry {
	modelId: string;
	callId: string;
	carrier: "reasoning_content" | "reasoning_details" | "think_tag_content" | "anthropic_thinking_block";
	reasoningContent: string;
	reasoningDetails?: unknown;
	reasoningSignature?: string;
	profileId: string;
	transport: "openai" | "anthropic" | "vertex";
	capturedAt: number;
	byteLength: number;
}
```

Then dispatch replay injection by `carrier` and `profileId`.

### Finding 5: GLM and Kimi preservation flags are missing

Current code evidence:

Searches for these fields in `src/` return no implementation:

```text
thinking.clear_thinking
thinking.keep
preserve_thinking
```

The only current thinking-object write is generic:

```text
src/modelConfiguration.ts:160-162
src/thinkingMode.ts:150-152
```

Probe-backed requirement:

- GLM preserved thinking uses `thinking.clear_thinking`.
- Kimi preserved thinking uses `thinking.keep`.
- Qwen preserve-thinking models use `preserve_thinking`.

Impact:

The extension cannot currently express the user-visible scenario that motivated the GLM probe design:

```text
Turn 0: thinking enabled and reasoning_content exists
Turn 1: thinking disabled
Turn 2: thinking re-enabled
```

For GLM/Kimi-style models, this is not just an on/off problem. The extension needs to decide whether prior reasoning is kept, cleared, or required for replay.

Suggested change:

Add provider-specific preservation controls to the request policy.

Implementation instruction:

Add a profile field:

```ts
type ReplayPreservationControl =
	| { kind: "none" }
	| { kind: "glm-clear-thinking"; clearThinking: boolean }
	| { kind: "kimi-keep"; keep: boolean }
	| { kind: "qwen-preserve-thinking"; preserveThinking: boolean };
```

Then set preservation fields only for matching profiles.

### Finding 6: The safety pattern list is stale and too narrow

Current code:

```ts
export const DEFAULT_DISABLE_THINKING_PATTERNS = [
	"mimo-v2-pro",
	"mimo-v2.5-pro",
	"mimo-v2.5",
	"mimo-v2-omni",
	"mimo-v2-flash",
	"deepseek-v4*",
];
```

Proof:

```text
src/thinkingMode.ts:17-24
package.json:366-375
```

Why this is incomplete:

The list was designed for the older MiMo/DeepSeek 400 problem. Current probe knowledge shows other default-thinking and forced-thinking model families can also require replay discipline:

- GLM-5.1 / GLM-5 / GLM-4.7
- Kimi K2.6 / Kimi K2.5
- Kimi K2 thinking model
- Qwen thinking-suffixed models

Impact:

The extension can treat non-listed default-thinking models as safe, even though they can emit reasoning and tool calls that later require replay.

Suggested change:

Replace the safety list with profiles that declare risk and behavior.

Implementation instruction:

Do not expand `DEFAULT_DISABLE_THINKING_PATTERNS` forever. Instead, add:

```ts
type ReplayRisk = "none" | "reasoning-content-required-after-tool-call" | "unknown";
```

Profiles with `ReplayRisk !== "none"` should trigger replay preflight and capture policy.

### Finding 7: MiniMax reasoning support is currently mis-modeled

Current code:

- `src/openai/openaiApi.ts:453-482` parses `reasoning_details`.
- `src/thinkingReplay.ts:30-89` only injects `reasoning_content` on OpenAI-compatible replay.
- The generic `thinkingMode` UI still offers enable/disable for every model.

Probe-backed facts:

- `reasoning_split: true` exposes MiniMax reasoning as `reasoning_details`.
- Native output may embed reasoning in `content` with `<think>...</think>`.
- `minimax-m2.7` has no confirmed parameter to disable thinking.

Impact:

The extension can parse MiniMax reasoning but cannot replay it in a provider-native way. The UI can also imply MiniMax thinking can be turned off when current evidence says it cannot.

Suggested change:

Create a MiniMax profile:

```ts
{
	id: "minimax-m2-reasoning-split",
	canDisableThinking: false,
	outputCarriers: ["reasoning_details", "think_tag_content"],
	replayCarriers: ["reasoning_details", "think_tag_content"],
	currentTurnControls: [{ kind: "reasoning_split" }]
}
```

Until replay is implemented for `reasoning_details`, the extension should either avoid enabling MiniMax tool-call thinking workflows or fail locally when history would require unsupported replay.

### Finding 8: OpenAI replay commit is too dependent on `finish_reason === "tool_calls"`

Current code:

- `src/openai/openaiApi.ts:566-570` calls `completeReplayTurn(finish)` only for `finish === "tool_calls"` or `finish === "stop"`.
- `src/openai/openaiApi.ts:596-605` commits only when `finishReason === "tool_calls"`.

Proof:

```text
src/openai/openaiApi.ts:566-570
src/openai/openaiApi.ts:596-605
```

Why this may be fragile:

Streaming providers differ. A provider may stream tool calls and then finish with a non-standard finish reason, omit the finish reason until `[DONE]`, or send final usage chunks with no choices. The probe work already found streaming behavior differs by provider and model.

Impact:

The extension may observe reasoning and tool calls, emit the tool call to VS Code, but fail to commit replay data. That creates a later replay miss.

Suggested change:

Commit replay when the stream completes and the pending turn has:

- at least one recorded tool call,
- non-empty structured reasoning content,
- no invalid state,
- no parse/network/cancellation error.

The commit should not depend only on the provider's `finish_reason` string.

Implementation instruction:

Move replay completion policy into `ThinkingReplayStore` or a small helper:

```ts
completePendingReplayTurn({ reason: "stream-complete" | "finish-tool-calls" | "finish-stop" | "abort" })
```

Then commit on stream completion when the pending turn is complete enough for safe replay.

### Finding 9: Model metadata lacks reasoning protocol metadata

Current generated metadata contains model routing, family, context size, output size, and broad capabilities:

```text
src/generated/infiniaiCatalogMetadata.generated.ts
```

Examples:

- `deepseek-v4-pro` is `apiMode: "anthropic"`.
- `glm-5.1` is `apiMode: "anthropic"`.
- `kimi-k2.6` is `apiMode: "anthropic"`.
- `mimo-v2.5-pro` is `apiMode: "anthropic"`.
- Qwen models are mostly `apiMode: "openai"`.

Proof:

```text
src/generated/infiniaiCatalogMetadata.generated.ts:247-264
src/generated/infiniaiCatalogMetadata.generated.ts:390-408
src/generated/infiniaiCatalogMetadata.generated.ts:464-482
src/generated/infiniaiCatalogMetadata.generated.ts:518-534
src/generated/infiniaiCatalogMetadata.generated.ts:624-832
```

What is missing:

- reasoning dialect,
- default thinking behavior,
- current-turn control support,
- replay carrier,
- replay preservation flag,
- disable support,
- forced thinking status,
- response-mode quirks.

Impact:

The extension infers too much from family strings and generic settings. This is brittle as models and gateway behavior change.

Suggested change:

Extend built-in metadata or add a separate reasoning profile table.

Implementation instruction:

Do not overload the broad `capabilities` object. Add a dedicated profile resolver:

```ts
interface ReasoningDialectProfile {
	id: string;
	modelPatterns: string[];
	transport: "openai" | "anthropic";
	family: string;
	defaultThinking: "on" | "off" | "auto" | "forced" | "unknown";
	currentTurnControls: CurrentTurnThinkingControlSpec[];
	replayCarrier: ReplayCarrier | "none" | "unknown";
	preservationControl?: ReplayPreservationControlSpec;
	canDisableThinking: boolean;
	canEnableThinking: boolean;
	responseModeNotes?: string[];
}
```

### Finding 10: Current tests verify mechanics, not provider dialect policy

Current tests cover useful mechanics:

- `src/thinkingReplayStore.test.ts`
- `src/thinkingReplay.test.ts`
- `src/openaiApi.test.ts`
- `src/anthropicApi.test.ts`
- `src/modelConfiguration.test.ts`
- `src/thinkingMode.test.ts`

But the tests mostly validate the current generic model:

- `applyDisableThinking` sets both `enable_thinking` and `thinking.type`.
- `thinkingMode: "enabled"` sets both `enable_thinking: true` and `thinking.type: "enabled"`.
- OpenAI replay injects `reasoning_content`.
- Anthropic replay injects a `thinking` block.

Proof:

```text
src/thinkingMode.test.ts:135-151
src/modelConfiguration.test.ts:131-164
src/thinkingReplay.test.ts:26-130
src/openaiApi.test.ts:150-189
src/anthropicApi.test.ts
```

What is missing:

- GLM `thinking.clear_thinking` branch tests.
- Kimi `thinking.keep` branch tests.
- Qwen `enable_thinking`-only tests.
- Qwen-VL profile tests.
- MiniMax `reasoning_details` replay tests.
- Anthropic Messages tests that reject OpenAI-only fields.
- Tests that capture replay for default-thinking models even without explicit round-trip opt-in.

Suggested change:

Port the probe matrix concepts into extension unit tests.

Implementation instruction:

Add test fixtures that assert request body shape, not just user setting resolution.

For example:

```text
GLM-5.1 + OpenAI route + disabled current turn
=> body.thinking.type === "disabled"
=> no body.enable_thinking

Qwen3-32b + OpenAI route + disabled current turn
=> body.enable_thinking === false
=> no body.thinking

Kimi K2.6 + OpenAI route + preserved replay
=> body.thinking.keep === true
=> replayed assistant.reasoning_content exists

MiniMax M2.7 + disabled current turn
=> no disable field is sent unless a confirmed disable profile exists

Anthropic route + disabled current turn
=> no top-level enable_thinking is sent
```

## Redesign Blueprint

### Principle 1: Resolve the profile first

Every request should start by resolving:

```text
model id + route transport + endpoint kind => reasoning dialect profile
```

The profile should drive:

- UI schema,
- request body fields,
- replay preflight,
- replay injection,
- replay capture,
- logging,
- local fail behavior.

### Principle 2: Keep current-turn control separate from replay behavior

The extension needs separate concepts:

```ts
type CurrentTurnThinkingState =
	| "provider-default"
	| "explicit-enabled"
	| "explicit-disabled"
	| "forced-enabled"
	| "unsupported";

type ReplayAction =
	| "not-needed"
	| "capture"
	| "inject"
	| "preserve"
	| "clear"
	| "fail-local";
```

This separation prevents the common mistake of assuming `enable_thinking: false` solves historical replay requirements.

### Principle 3: Fail locally before sending known-bad history

The previous design report is still correct on this point:

```text
cache miss -> applyDisableThinking() alone is not guaranteed safe
```

If the outgoing history contains an assistant tool-call turn that the selected profile says requires replay, and the extension cannot provide the required replay field, the extension should fail locally before sending the request.

### Principle 4: Store provider-native replay data

The replay store can still be text-oriented internally, but it must remember enough metadata to reconstruct the provider-native input shape.

Do not collapse all carriers into `reasoning_content`.

### Principle 5: Do not expose unsupported UI controls

The configuration UI should not invite users to choose unsupported or misleading controls.

Examples:

- MiniMax M2.7 should not show a "disable thinking" control until a working disable parameter exists.
- Qwen should use `enable_thinking`, not `thinking.type`.
- GLM/Kimi advanced replay controls should only appear for those profiles.
- Anthropic Messages should not inherit OpenAI Chat Completions knobs.

## Suggested Implementation Plan

### Milestone 1: Add profile resolver

Create:

```text
src/reasoningDialect.ts
src/reasoningDialect.test.ts
```

Responsibilities:

1. Match model IDs and route transport to profiles.
2. Return an explicit unknown profile when no rule matches.
3. Encode default thinking behavior and valid controls.
4. Encode replay carriers and preservation flags.

Minimum profiles:

```text
deepseek-v4
glm-5-default-thinking
glm-4-7-default-thinking
glm-4-6-auto-thinking
kimi-k2-toggleable
kimi-k2-forced-thinking
mimo-v2
minimax-m2
qwen3-open-hybrid
qwen3-forced-thinking
qwen3-instruct
qwen3-vl-hybrid
qwen3-vl-forced-thinking
anthropic-claude-compatible
unknown
```

### Milestone 2: Replace generic request shaping

Create:

```text
src/reasoningRequest.ts
src/reasoningRequest.test.ts
```

Responsibilities:

1. Apply current-turn thinking controls using the profile.
2. Apply replay-preservation controls using the profile.
3. Refuse unsupported controls.
4. Avoid OpenAI-only fields on Anthropic Messages bodies.

Replace direct calls to:

```ts
applyDisableThinking(...)
applyOpenAIModelConfiguration(...)
applyAnthropicModelConfiguration(...)
```

with profile-aware request shaping.

`maxOutputTokens` can stay generic. `reasoningEffort` and `thinkingMode` should become profile-aware.

### Milestone 3: Split replay preflight from opt-in

Update `runOpenAIRequest(...)` and `runAnthropicRequest(...)`.

New request order:

1. Resolve route.
2. Resolve reasoning profile.
3. Convert messages.
4. Determine effective current-turn thinking state.
5. Run replay preflight for profiles with replay risk.
6. Fail locally if history is unsafe.
7. Apply profile-native request controls.
8. Start pending replay capture if the current response may produce required reasoning.
9. Send request.
10. Commit or abort replay based on stream completion and observed tool calls.

The key change is step 8: capture should start for default-thinking and forced-thinking profiles, not only for explicit round-trip opt-in.

### Milestone 4: Extend replay store entries

Update:

```text
src/thinkingReplayStore.ts
src/thinkingReplay.ts
```

Store carrier and profile metadata. Add migration behavior for existing v1 entries:

- existing entries can be treated as `carrier: "reasoning_content"` for backward compatibility,
- do not use existing entries for profiles that require a different carrier.

### Milestone 5: Add dialect tests

Add tests that use concrete model IDs and route transports.

Required test groups:

1. Current-turn field mapping.
2. Replay field injection.
3. Preservation flags.
4. Default-thinking capture policy.
5. Local fail policy on replay miss.
6. Anthropic transport field hygiene.
7. MiniMax no-disable behavior.

### Milestone 6: Update configuration UX

Update:

```text
src/modelConfiguration.ts
package.nls.json
package.nls.zh-cn.json
```

Goals:

1. Avoid showing one generic thinking control for all models.
2. Use profile-derived labels and descriptions.
3. Keep "unset" as the safe default where support is unknown.
4. Make unsupported fields unavailable, not merely described as risky.

## Concrete Policy Recommendations

### DeepSeek V4

Default posture:

- Keep conservative safety by default.
- If thinking is enabled, capture and replay `reasoning_content`.
- Do not rely on VS Code `LanguageModelThinkingPart` for correctness.

### GLM 5.1 / 5 / 4.7

Default posture:

- Treat as default-thinking profiles.
- Start replay capture automatically unless explicitly disabled.
- Use `thinking.type` for current-turn control.
- Use `thinking.clear_thinking` for preserved-thinking transitions.

### Kimi K2.5 / K2.6

Default posture:

- Treat as default-thinking toggleable profiles.
- Use `thinking.type` for current-turn control.
- Use `thinking.keep` for preserved-thinking replay.

### Kimi K2 Thinking

Default posture:

- Treat as forced-thinking.
- Do not show a disable control unless a future probe proves it works.
- Capture replay automatically when tool calls are possible.

### MiMo V2

Default posture:

- Use `thinking.type` only.
- Keep replay discipline for `reasoning_content`.
- `reasoning_effort` should not be surfaced as meaningful control unless a future probe proves behavioral effect.

### MiniMax M2

Default posture:

- Do not claim thinking can be disabled for `minimax-m2.7`.
- If `reasoning_split` is enabled, capture and replay `reasoning_details`, not `reasoning_content`.
- If native `<think>` mode is used, preserve content in the shape the provider expects or avoid replay-dependent tool workflows.

### Qwen 3

Default posture:

- Use top-level `enable_thinking`.
- Do not also send `thinking.type`.
- Treat response-mode differences as real. Some Qwen models expose visible reasoning only in streaming mode.

### Qwen-VL

Default posture:

- Use Qwen-VL-specific profiles.
- Do not send text-only Qwen budget/control assumptions to multimodal models without profile support.

### Anthropic Messages Transport

Default posture:

- Do not send top-level `enable_thinking`.
- Do not reuse OpenAI Chat Completions thinking fields.
- Keep thinking block replay and signature preservation separate from OpenAI `reasoning_content`.

## Diagnostic Logging Improvements

Current logging already records useful fields:

```text
forceDisable
roundTripOptIn
roundTripAllowed
roundTripReplayed
roundTripMissing
roundTripConflicts
thinkingDisabled
assistantToolCalls
assistantReasoning
assistantToolCallsMissingReasoning
```

Add these fields:

```text
reasoningProfile
reasoningDialect
currentTurnThinkingState
currentTurnControlKind
replayCarrier
preservationControlKind
captureStarted
captureReason
unsupportedControlIgnored
localFailReasonCode
```

Do not log reasoning text, tool arguments, tool results, user prompts, or full request bodies.

## Why The Previous Reports Are Now Incomplete

`reports/infiniai-reasoning-content-400-report.md` and `reports/infiniai-thinking-replay-store-design-report.md` correctly diagnosed the early MiMo/DeepSeek replay problem. They are still valuable for:

- why VS Code `LanguageModelThinkingPart` is not a replay guarantee,
- why the extension needs its own replay store,
- why replay misses should fail locally,
- why reasoning content should not be logged.

They are incomplete for the current model landscape because they focus mainly on:

```text
mimo-v2*
deepseek-v4*
```

The current probe-backed model landscape includes GLM, Kimi, MiniMax, MiMo, Qwen, and Qwen-VL dialects. The extension needs a generalized dialect-profile architecture, not a longer disable list.

## Acceptance Criteria For A Fix

A fix should meet these criteria:

1. The extension does not send top-level `enable_thinking` to Anthropic Messages request bodies.
2. The extension does not send both `enable_thinking` and `thinking.type` as a generic thinking control for every OpenAI-compatible model.
3. The model configuration UI exposes thinking controls only when the selected profile supports them.
4. Default-thinking profiles start replay capture automatically when tool calls are possible.
5. Replay preflight runs for profiles with replay risk, independent of explicit round-trip opt-in.
6. GLM replay scenarios can set `thinking.clear_thinking` correctly.
7. Kimi replay scenarios can set `thinking.keep` correctly.
8. Qwen profiles use `enable_thinking` without `thinking.type`.
9. MiniMax split mode can preserve `reasoning_details`, or the extension fails locally before entering unsupported replay.
10. Local fail happens before upstream request when required historical reasoning is missing.
11. Tests assert concrete request body shapes for each supported dialect.
12. Reasoning text remains absent from logs, telemetry, settings, and diagnostics.

## Recommended Next Step

Start with Milestone 1 and Milestone 2 together:

1. Add `src/reasoningDialect.ts`.
2. Add `src/reasoningRequest.ts`.
3. Write request-shape unit tests for GLM, Kimi, MiMo, MiniMax, Qwen, Qwen-VL, and Anthropic transport hygiene.

Do not start by adding more entries to `DEFAULT_DISABLE_THINKING_PATTERNS`. That would patch symptoms while keeping the wrong abstraction in place.
