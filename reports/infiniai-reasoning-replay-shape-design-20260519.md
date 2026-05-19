# InfiniAI Reasoning Replay Shape Design

Date: 2026-05-19

## Executive Summary

The extension should implement reasoning replay as a family-specific protocol layer, not as one generic `reasoning_content` feature.

The current replay store and preflight path are a good foundation, but the next implementation step must preserve provider-native replay shapes:

- DeepSeek, MiMo, GLM, Kimi, and selected Qwen profiles replay `messages[].reasoning_content`.
- GLM also needs `thinking.clear_thinking`.
- Kimi also needs `thinking.keep`.
- Qwen preserve-thinking profiles also need `preserve_thinking`.
- MiniMax split mode uses `messages[].reasoning_details`, not `reasoning_content`.
- MiniMax native mode uses `<think>...</think>` in assistant `content`.
- Anthropic-compatible routes use `thinking` content blocks and signatures.

The flat setting `infiniai.enableThinkingRoundTripForModels` should not be the source of truth for this behavior. The source of truth should be the resolved reasoning profile:

```text
model id + route transport + endpoint kind => reasoning replay profile
```

Once a profile has a complete and tested replay adapter, the profile can enable safe replay by default. The user setting can remain as an override or experiment surface, but it cannot express replay carriers, preservation flags, or transport-specific injection rules by itself.

## Design Goal

Build a replay layer that can answer these questions for each outgoing request:

1. Which replay carrier does this model family require?
2. Does this assistant tool-call history already contain the correct carrier?
3. If not, can the extension inject a matching stored replay entry?
4. Does the request body need a provider-specific preservation flag?
5. If replay is required but unavailable, should the extension fail locally before the upstream request?

The result should be a protocol-safe path where every family either:

- replays in the provider-native shape,
- disables thinking before any replay-dependent history exists, or
- fails locally before sending a known-bad request.

## Non-Goals

This design does not make hidden reasoning visible to users.

This design does not log, expose, or persist reasoning text outside the bounded replay store.

This design does not depend on VS Code `LanguageModelThinkingPart` for correctness.

This design does not claim MiniMax native `<think>` replay is safe until the injection semantics are implemented and tested. MiniMax split mode should come first.

## Replay Shape Matrix

### DeepSeek V4

Models:

```text
deepseek-v4*
```

Replay shape:

```text
carrier: reasoning_content
capture: streaming reasoning_content / thinking text
store: reasoningContent string
inject: assistant.reasoning_content
preservation request field: none confirmed
disable control: thinking.type where supported by the gateway profile
```

Implementation posture:

- Use the existing `reasoning_content` injection path.
- Keep replay preflight strict for assistant tool-call messages.
- Do not treat VS Code thinking-part support as a replay guarantee.

### MiMo V2

Models:

```text
mimo-v2-pro
mimo-v2.5-pro
mimo-v2.5
mimo-v2-omni
mimo-v2-flash
mimo-v2*
```

Replay shape:

```text
carrier: reasoning_content
capture: streaming reasoning_content / thinking text
store: reasoningContent string
inject: assistant.reasoning_content
preservation request field: none
disable control: thinking.type
```

Implementation posture:

- MiMo is the simplest `reasoning_content` adapter family.
- Existing cache entries can continue to work after v2 entry migration.
- Once the adapter is tested, `mimo-v2*` can be a built-in profile default for replay.

### GLM 5.1 / 5 / 4.7

Models:

```text
glm-5.1
glm-5
glm-4.7
```

Replay shape:

```text
carrier: reasoning_content
capture: streaming reasoning_content
store: reasoningContent string
inject: assistant.reasoning_content
preservation request field: thinking.clear_thinking
disable control: thinking.type
default thinking: on
```

Preservation policy:

- When replaying prior reasoning and continuing a thinking-capable chat, set:

```json
{
	"thinking": {
		"clear_thinking": false
	}
}
```

- When the user explicitly disables thinking and the profile supports clearing prior thinking, set:

```json
{
	"thinking": {
		"type": "disabled",
		"clear_thinking": true
	}
}
```

Implementation posture:

- GLM must not be modeled as only a current-turn `thinking.type` toggle.
- Replay injection and preservation control must be coordinated in one request policy.
- Default-thinking GLM profiles should start capture automatically when tool calls are possible.

### Kimi K2.5 / K2.6 / K2 Thinking

Models:

```text
kimi-k2.5
kimi-k2.6
kimi-k2-thinking
```

Replay shape:

```text
carrier: reasoning_content
capture: streaming reasoning_content
store: reasoningContent string
inject: assistant.reasoning_content
preservation request field: thinking.keep
disable control: thinking.type for toggleable Kimi K2 profiles
default thinking: on for K2.5/K2.6, forced for kimi-k2-thinking
```

Preservation policy:

- When replaying prior reasoning and preserving the thinking state, set:

```json
{
	"thinking": {
		"keep": true
	}
}
```

- Do not expose a disable control for forced-thinking profiles unless probes prove a valid disable field.

Implementation posture:

- Kimi replay must include both injected `assistant.reasoning_content` and request-body preservation.
- `kimi-k2-thinking` should automatically capture replay when tool calls are possible.

### Qwen Preserve-Thinking Profiles

Models:

```text
Qwen thinking-suffixed profiles
Qwen preserve-thinking profiles confirmed by probes
Qwen-VL preserve-thinking profiles confirmed by multimodal probes
```

Replay shape:

```text
carrier: reasoning_content
capture: streaming reasoning_content when visible
store: reasoningContent string
inject: assistant.reasoning_content
preservation request field: preserve_thinking
current-turn control: enable_thinking
```

Preservation policy:

- For Qwen profiles that need prior thinking preservation, set:

```json
{
	"preserve_thinking": true
}
```

- For Qwen current-turn disable, use only:

```json
{
	"enable_thinking": false
}
```

Implementation posture:

- Never send both `enable_thinking` and `thinking.type` as a generic Qwen control.
- Qwen-VL must be profiled separately from text-only Qwen where multimodal request shape matters.
- Do not add broad `qwen*` defaults until exact preserve-thinking profiles are confirmed.

### MiniMax M2 Split Mode

Models:

```text
minimax-m2.1
minimax-m2.5
minimax-m2.7
```

Replay shape:

```text
carrier: reasoning_details
capture: raw streaming reasoning_details array
store: reasoningDetails unknown[]
inject: assistant.reasoning_details
preservation request field: reasoning_split=true when split mode is selected
disable control: none confirmed for minimax-m2.7
```

Implementation posture:

- Do not collapse MiniMax split reasoning into `reasoningContent` only.
- Store the raw `reasoning_details` array or a normalized structure that can reconstruct the original input field.
- Until `reasoning_details` injection is implemented, MiniMax split-mode replay-required histories must fail locally.
- Do not claim thinking can be disabled for MiniMax M2.7 until a probe proves the field.

### MiniMax Native Think-Tag Mode

Replay shape:

```text
carrier: think_tag_content
capture: hidden text inside <think>...</think>
store: reasoningContent string
inject: assistant.content containing <think>...</think>
preservation request field: none confirmed
disable control: none confirmed
```

Implementation posture:

- This should be a second MiniMax milestone, not the first.
- Injection is riskier because it rewrites assistant `content`, not a dedicated structured field.
- The first implementation should prefer MiniMax split mode and locally fail native-mode replay until the exact expected input shape is verified.

### Anthropic Messages Route

Replay shape:

```text
carrier: anthropic_thinking_block
capture: thinking text + signature
store: reasoningContent string + reasoningSignature string
inject: thinking content block before tool_use block
preservation request field: Anthropic-native only
disable control: do not send OpenAI enable_thinking
```

Implementation posture:

- Keep Anthropic replay separate from OpenAI Chat Completions replay.
- Existing `thinking` block injection is the correct direction.
- Never send top-level `enable_thinking` to Anthropic Messages request bodies.

## Proposed Types

### Replay Carrier

Add or complete this shared carrier type:

```ts
export type ReplayCarrier =
	| "reasoning_content"
	| "reasoning_details"
	| "think_tag_content"
	| "anthropic_thinking_block";
```

### Replay Entry

Extend `ThinkingReplayEntry` in `src/thinkingReplayStore.ts`:

```ts
export interface ThinkingReplayEntry {
	readonly modelId: string;
	readonly callId: string;
	readonly profileId: string;
	readonly transport: "openai" | "anthropic" | "vertex";
	readonly carrier: ReplayCarrier;
	readonly reasoningContent?: string;
	readonly reasoningDetails?: unknown[];
	readonly reasoningSignature?: string;
	readonly capturedAt: number;
	readonly byteLength: number;
}
```

Migration rule:

- Existing v1 entries do not have `carrier`, `profileId`, or `transport`.
- Load them as:

```ts
{
	profileId: "legacy-reasoning-content",
	transport: "openai",
	carrier: "reasoning_content"
}
```

- Legacy entries may only satisfy profiles whose replay carrier is `reasoning_content`.
- Legacy entries must not satisfy `reasoning_details`, `think_tag_content`, or `anthropic_thinking_block` profiles.

### Pending Turn

Extend pending turns so capture code can record provider-native payloads:

```ts
interface PendingTurn {
	readonly modelId: string;
	readonly profileId: string;
	readonly transport: "openai" | "anthropic" | "vertex";
	readonly carrier: ReplayCarrier;
	readonly callIds: Set<string>;
	readonly chunks: string[];
	readonly detailChunks: unknown[];
	readonly signatureChunks: string[];
	byteLength: number;
	invalid: boolean;
}
```

New store methods:

```ts
beginTurn(input: {
	modelId: string;
	profileId: string;
	transport: "openai" | "anthropic" | "vertex";
	carrier: ReplayCarrier;
}): PendingThinkingTurn;

appendReasoningText(turnId: string, text: string): void;
appendReasoningDetails(turnId: string, details: readonly unknown[]): void;
appendReasoningSignature(turnId: string, signature: string): void;
recordToolCall(turnId: string, callId: string): void;
lookup(input: {
	modelId: string;
	callId: string;
	profileId: string;
	carrier: ReplayCarrier;
}): ThinkingReplayEntry | undefined;
```

Backward-compatible helpers can remain temporarily:

```ts
beginTurn(modelId: string): PendingThinkingTurn;
appendReasoning(turnId: string, text: string): void;
lookup(modelId: string, callId: string): ThinkingReplayEntry | undefined;
```

But new replay code should use the structured overloads.

## Proposed Adapter Boundary

Create:

```text
src/reasoningReplayAdapter.ts
```

Responsibilities:

1. Select an adapter from a `ReasoningDialectProfile`.
2. Detect whether an assistant message already contains the correct replay carrier.
3. Inject stored replay entries into outgoing assistant tool-call history.
4. Capture provider-native stream chunks.
5. Apply preservation request fields.

Suggested interface:

```ts
export interface ReplayCaptureDelta {
	readonly carrier: ReplayCarrier;
	readonly reasoningContent?: string;
	readonly reasoningDetails?: readonly unknown[];
	readonly reasoningSignature?: string;
}

export interface ReplayInjectionResult<TMessage> {
	readonly message: TMessage;
	readonly injected: boolean;
	readonly missingCallIds: readonly string[];
	readonly conflictingCallIds: readonly string[];
}

export interface ReasoningReplayAdapter<TMessage> {
	readonly carrier: ReplayCarrier;
	hasReplay(message: TMessage): boolean;
	injectReplay(input: {
		modelId: string;
		profileId: string;
		message: TMessage;
		store: ThinkingReplayStore;
	}): ReplayInjectionResult<TMessage>;
	applyPreservation(input: {
		body: Record<string, unknown>;
		action: "preserve" | "clear";
	}): void;
}
```

Recommended adapters:

```text
reasoningContentAdapter
reasoningDetailsAdapter
thinkTagContentAdapter
anthropicThinkingBlockAdapter
```

## Request Policy Design

Add a single request policy step after message conversion and before `prepareRequestBody(...)`:

```text
resolve profile
resolve adapter
run replay preflight
decide current-turn thinking state
decide replay action
apply request controls
start pending capture if current response may produce required replay data
send request
commit or abort pending replay turn
```

### Replay Actions

Use an explicit action type:

```ts
type ReplayAction =
	| { kind: "skip"; reason: "profile-has-no-replay-risk" | "thinking-disabled-before-history" }
	| { kind: "inject"; carrier: ReplayCarrier }
	| { kind: "capture"; carrier: ReplayCarrier; reason: "default-thinking" | "forced-thinking" | "explicit-enabled" }
	| { kind: "preserve"; carrier: ReplayCarrier }
	| { kind: "clear"; carrier: ReplayCarrier }
	| { kind: "fail-local"; reasonCode: "missing-replay" | "carrier-mismatch" | "unsupported-carrier" };
```

Do not infer this from `enableThinkingRoundTripForModels` alone.

### Local Fail Rule

If a profile says replay is required and outgoing history contains assistant tool-call messages without a valid carrier, the extension must fail locally when:

- no matching store entry exists,
- the stored entry has the wrong carrier,
- multiple tool calls in one assistant message map to conflicting replay payloads,
- the adapter cannot safely inject the carrier,
- storage has expired or been cleared.

The extension must not send a known-bad upstream request and hope that a current-turn disable flag will fix historical history.

## File-by-File Implementation Guidance

### `src/reasoningDialect.ts`

Add enough metadata for replay adapters:

```ts
interface ReasoningDialectProfile {
	id: string;
	transport: "openai" | "anthropic" | "vertex";
	defaultThinking: "on" | "off" | "auto" | "forced" | "unknown";
	currentTurnControl: CurrentTurnThinkingControlSpec;
	replayCarrier: ReplayCarrier | "none" | "unknown";
	preservationControl: ReplayPreservationControlSpec;
	replayRisk: "none" | "required-after-tool-call" | "unknown";
	canDisableThinking: boolean;
	canEnableThinking: boolean;
}
```

Profile resolver rules:

- Route transport wins over model family assumptions.
- Anthropic route means Anthropic content-block replay, even for model families that use `reasoning_content` on Chat Completions routes.
- MiniMax split mode must resolve to `reasoning_details`.
- MiniMax native mode must resolve to `think_tag_content` only after the request path can distinguish native mode from split mode.
- Unknown profiles must not expose thinking controls or automatic replay defaults.

### `src/reasoningRequest.ts`

Keep this file focused on request body controls:

- Qwen: write `enable_thinking`.
- GLM/Kimi/MiMo/DeepSeek: write `thinking.type`.
- GLM preservation: write `thinking.clear_thinking`.
- Kimi preservation: write `thinking.keep`.
- Qwen preservation: write `preserve_thinking`.
- MiniMax split: write `reasoning_split` only when that mode is intentionally selected.
- Anthropic: do not write OpenAI Chat Completions controls.

The function should return diagnostics:

```ts
interface ReasoningRequestControlResult {
	currentTurnControlKind: string;
	preservationControlKind: string;
	ignoredControls: readonly string[];
	writtenFields: readonly string[];
}
```

Diagnostics must list field names only, never reasoning text.

### `src/thinkingReplayStore.ts`

Add carrier-aware entries and lookups.

Rules:

1. The lookup key remains `modelId + callId`, but successful lookup must also check `profileId` or compatible carrier.
2. `reasoning_content` legacy entries can be accepted for `reasoning_content` profiles.
3. `reasoning_details` profiles must require `reasoningDetails`.
4. `anthropic_thinking_block` profiles should require text and may require signature when present.
5. Byte accounting must include serialized `reasoningDetails` and signatures.
6. Persistence must continue to use bounded local plaintext or memory storage.

### `src/thinkingReplay.ts`

Replace OpenAI-only assumptions with adapter calls.

Current behavior:

```text
assistant tool_calls + stored text => assistant.reasoning_content
```

New behavior:

```text
profile + adapter + assistant tool_calls + stored carrier => provider-native replay field
```

Expected public functions:

```ts
applyOpenAIThinkingReplay({
	profile,
	messages,
	store,
}): ThinkingReplayPreflight<OpenAIChatMessage>;

applyAnthropicThinkingReplay({
	profile,
	messages,
	store,
}): ThinkingReplayPreflight<AnthropicMessage>;
```

Do not allow MiniMax `reasoning_details` profiles to pass through the `reasoning_content` adapter.

### `src/openai/openaiTypes.ts`

Extend `OpenAIChatMessage`:

```ts
export interface OpenAIChatMessage {
	role: OpenAIChatRole;
	content?: string | ChatMessageContent[];
	name?: string;
	tool_calls?: OpenAIToolCall[];
	tool_call_id?: string;
	reasoning_content?: string;
	reasoning_details?: ReasoningDetail[];
	cache_control?: CacheControl;
}
```

If MiniMax `reasoning_details` does not match the current `ReasoningDetail` union exactly, add a looser provider-native type for replay input:

```ts
export type ProviderReasoningDetail = ReasoningDetail | Record<string, unknown>;
```

### `src/openai/openaiApi.ts`

Streaming capture changes:

- When the active profile carrier is `reasoning_content`, append text deltas from `reasoning_content` / simple thinking fields.
- When the active profile carrier is `reasoning_details`, append raw `reasoning_details` arrays before extracting display text.
- When the active profile carrier is `think_tag_content`, capture hidden XML think-block text into the replay store, not only a boolean that hidden text was seen.

Constructor changes:

```ts
new OpenaiApi({
	thinkingReplayStore,
	pendingThinkingTurn,
	emitThinkingParts,
	reasoningProfile,
	replayAdapter,
})
```

Commit changes:

- Commit when the stream completes and pending turn has at least one tool call and the required carrier payload.
- Do not rely only on `finish_reason === "tool_calls"`.
- Abort on parse, network, or cancellation errors.

### `src/anthropic/anthropicApi.ts`

Keep Anthropic replay on a separate adapter:

- Capture `thinking_delta` text.
- Capture `signature_delta`.
- Commit when the message completes and tool calls were emitted.
- Inject a `thinking` block before the first `tool_use` block.
- Never write `enable_thinking` to Anthropic request bodies.

### `src/provider.ts`

Provider flow should become:

```text
resolve route
resolve reasoning profile
convert messages
run carrier-aware replay preflight
resolve replay decision
prepare request body
apply current-turn and preservation controls
begin pending replay capture with profile carrier
send request
process stream
commit or abort replay
```

Logging additions:

```text
reasoningProfile
replayCarrier
currentTurnControlKind
preservationControlKind
replayAction
captureStarted
captureReason
localFailReasonCode
```

Do not log reasoning text, `reasoning_details`, tool arguments, tool results, or full request bodies.

## Testing Plan

### Unit Tests: Profile Resolution

File:

```text
src/reasoningDialect.test.ts
```

Required cases:

1. `deepseek-v4-pro + openai` => `reasoning_content`.
2. `mimo-v2.5-pro + openai` => `reasoning_content`.
3. `glm-5.1 + openai` => `reasoning_content`, `thinking.clear_thinking`.
4. `kimi-k2.6 + openai` => `reasoning_content`, `thinking.keep`.
5. `kimi-k2-thinking + openai` => forced thinking, no disable control.
6. `qwen... + openai` => `enable_thinking`, optional `preserve_thinking` only for confirmed profiles.
7. `minimax-m2.7 + openai split` => `reasoning_details`, no disable control.
8. `glm-5.1 + anthropic` => `anthropic_thinking_block`, no OpenAI controls.

### Unit Tests: Request Shape

File:

```text
src/reasoningRequest.test.ts
```

Required assertions:

```text
Qwen disabled => enable_thinking=false and no thinking.type
GLM disabled => thinking.type=disabled and no enable_thinking
GLM preserve => thinking.clear_thinking=false
GLM clear => thinking.clear_thinking=true
Kimi preserve => thinking.keep=true
Qwen preserve => preserve_thinking=true
MiniMax M2.7 disabled => no disable field
Anthropic disabled => no enable_thinking, no OpenAI thinking.type
```

### Unit Tests: Replay Injection

File:

```text
src/thinkingReplay.test.ts
```

Required assertions:

1. `reasoning_content` entry injects `assistant.reasoning_content`.
2. `reasoning_details` entry injects `assistant.reasoning_details`.
3. `reasoning_details` profile rejects a legacy `reasoning_content` entry.
4. `anthropic_thinking_block` entry injects a `thinking` block before `tool_use`.
5. A wrong-carrier entry causes local fail preflight.
6. Multiple tool calls in one assistant message require matching replay payloads.
7. Existing valid replay fields are not overwritten.

### Unit Tests: Streaming Capture

Files:

```text
src/openaiApi.test.ts
src/anthropicApi.test.ts
```

Required assertions:

1. OpenAI `reasoning_content` chunks are stored as `reasoning_content`.
2. OpenAI `reasoning_details` arrays are stored as `reasoning_details`, not flattened text only.
3. XML `<think>` content is captured only for `think_tag_content` profiles.
4. Anthropic thinking/signature deltas are stored as `anthropic_thinking_block`.
5. Replay commit can happen on stream completion when reasoning payload and tool calls exist, even if `finish_reason` is missing or provider-specific.
6. Replay aborts on malformed stream errors and cancellation.

### Integration-Like Request Tests

Use small in-process request-body tests, not live network calls:

```text
GLM replay hit => assistant.reasoning_content + thinking.clear_thinking=false
Kimi replay hit => assistant.reasoning_content + thinking.keep=true
Qwen replay hit => assistant.reasoning_content + preserve_thinking=true
MiniMax split replay hit => assistant.reasoning_details + reasoning_split=true
Anthropic replay hit => thinking block before tool_use, no enable_thinking
Replay miss on required profile => fail locally before fetch
```

## Rollout Policy

### Phase 1: Structured `reasoning_content` Families

Implement and test:

```text
deepseek-v4*
mimo-v2*
glm-5.1
glm-5
glm-4.7
kimi-k2.5
kimi-k2.6
kimi-k2-thinking
```

Do not populate broad Qwen or MiniMax defaults yet.

### Phase 2: Qwen Preserve-Thinking Profiles

Implement exact Qwen profile defaults only after probes confirm:

- visible `reasoning_content` carrier,
- tool-call replay requirement,
- `preserve_thinking` behavior,
- text-only versus VL differences.

### Phase 3: MiniMax Split Mode

Implement:

```text
reasoning_split=true
reasoning_details capture
reasoning_details storage
reasoning_details injection
local fail on missing/wrong carrier
```

Do not implement MiniMax native `<think>` replay in this phase.

### Phase 4: MiniMax Native Think-Tag Mode

Implement only after the expected replay input shape is verified.

The safe default before that verification is local fail for replay-required native think-tag histories.

### Phase 5: Defaults

Only after the profile adapters pass tests should built-in defaults be populated.

Safe candidates after Phase 1:

```jsonc
[
	"deepseek-v4*",
	"mimo-v2*",
	"glm-5.1",
	"glm-5",
	"glm-4.7",
	"kimi-k2.5",
	"kimi-k2.6",
	"kimi-k2-thinking"
]
```

These defaults should preferably live in the profile table, not only in `DEFAULT_ENABLE_THINKING_ROUND_TRIP_PATTERNS`.

If `DEFAULT_ENABLE_THINKING_ROUND_TRIP_PATTERNS` is populated for backward compatibility, profile policy still wins. A matching model must not be allowed through a replay path unless the resolved profile adapter supports the required carrier.

## Acceptance Criteria

1. Every supported replay profile declares one replay carrier.
2. Replay store entries persist carrier, profile, transport, and provider-native payload.
3. Legacy entries are accepted only for compatible `reasoning_content` profiles.
4. GLM replay requests can inject `reasoning_content` and set `thinking.clear_thinking`.
5. Kimi replay requests can inject `reasoning_content` and set `thinking.keep`.
6. Qwen replay requests can inject `reasoning_content` and set `preserve_thinking`.
7. MiniMax split-mode requests can inject `reasoning_details`.
8. Anthropic requests can inject thinking blocks with signatures.
9. Anthropic requests never receive top-level `enable_thinking`.
10. MiniMax native think-tag replay is either implemented with tests or fails locally.
11. Replay-required profiles fail locally before fetch on replay miss or carrier mismatch.
12. Reasoning text and raw reasoning details are not logged.
13. `npm run lint` passes.
14. `npm test` passes.

## Practical Implementation Sequence

1. Add carrier metadata to `ReasoningDialectProfile`.
2. Extend `ThinkingReplayEntry` with carrier/profile/transport fields and migration.
3. Add carrier-aware pending turn capture methods.
4. Implement `reasoningContentAdapter`.
5. Move current OpenAI replay injection through `reasoningContentAdapter`.
6. Add GLM/Kimi/Qwen preservation application to replay policy.
7. Implement `anthropicThinkingBlockAdapter` using the current Anthropic replay behavior.
8. Implement `reasoningDetailsAdapter` for MiniMax split mode.
9. Add stream capture support for raw `reasoning_details`.
10. Add local fail for unsupported `think_tag_content`.
11. Add request-body integration tests.
12. Populate profile-owned safe defaults only after adapter tests pass.

## Key Rule

Do not send a request because the model ID matched a pattern.

Send a request only when the resolved profile, replay adapter, request body controls, and replay preflight agree that the provider-native protocol can be satisfied.
