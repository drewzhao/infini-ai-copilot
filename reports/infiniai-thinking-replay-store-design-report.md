# InfiniAI Thinking Replay Store Design and Implementation Report

Date: 2026-05-15

## Executive Summary

The safe way to enable thinking mode for `deepseek-v4*` and `mimo-v2*` is to add an extension-owned `reasoning_content` replay store with two supported backends:

- `localPlaintext`, the default backend, which stores replay entries in a local plaintext extension-storage file and supports restart continuity.
- `memory`, an explicit opt-in backend for users who do not want replay data written to disk and accept that thinking tool-call conversations may not continue after VS Code reload or restart.

The current `0.5.4` posture is intentionally conservative:

- Affected models are force-disabled by default with `enable_thinking: false` and `thinking: { type: "disabled" }`.
- `infiniai.enableThinkingRoundTripForModels` exists, but it does not currently bypass the guard.
- `LanguageModelThinkingPart` constructor availability is not treated as proof that `reasoning_content` can be replayed safely.

To make the opt-in setting genuinely useful, the extension must save exact upstream structured reasoning content for assistant turns that emit tool calls, retain that replay data through the selected backend, and inject the exact content into future OpenAI-compatible assistant history messages.

The v1 design is:

1. `localPlaintext` is the default replay backend for models matched by `infiniai.enableThinkingRoundTripForModels`.
2. `memory` is a separate explicit opt-in backend for users who prefer no disk persistence and accept no restart continuity.
3. Storage backend selection is separate from model opt-in: `infiniai.enableThinkingRoundTripForModels` enables the feature for model families, while `infiniai.thinkingReplayStore` selects `localPlaintext` or `memory`.
4. Restart continuity is required for the default `localPlaintext` backend while entries remain within TTL and size bounds.
5. Restart continuity is not promised for the `memory` backend; post-restart replay misses must fail locally before sending upstream requests.
6. Both backends keep an in-memory index for request-time lookup.
7. Replay entries are keyed by `modelId` and upstream `tool_call.id`.
8. The extension captures only structured upstream reasoning fields, not best-effort UI-only or XML `<think>` text.
9. Replay data is bounded by entry count, byte size, and TTL.
10. On replay miss while thinking is enabled, the extension fails locally before sending the upstream request.
11. The extension does not silently sanitize history in v1.

This design is Stable-compatible, Insiders-compatible, and Marketplace-safe because it does not require proposed VS Code APIs.

## Problem Statement

InfiniAI thinking models such as `mimo-v2*` and `deepseek-v4*` can stream chain-of-thought data through `reasoning_content`. When an assistant turn in thinking mode performs tool calls, the next request must include that assistant turn's exact `reasoning_content`.

If the next request contains an assistant message with `tool_calls` but no matching `reasoning_content`, upstream may reject it with HTTP 400.

Current VS Code Stable cannot expose `LanguageModelThinkingPart` as a public stable API. VS Code Insiders can expose the proposed constructor, but that still does not prove the full chat history path will preserve and replay thinking parts.

Therefore, safe thinking support must be owned by the extension request pipeline.

## Proposed API Compatibility Note

The Marketplace build must not declare `enabledApiProposals`. `LanguageModelThinkingPart` may still be detected at runtime in local development hosts, custom VS Code builds, or allowlisted environments, but this detector is only an optional compatibility path for emitting or preserving thinking parts.

Constructor availability is not a replay-safety signal. A request is safe only when the extension-owned replay store can preflight every assistant tool-call turn that requires `reasoning_content`. On replay miss, stale data, conflict, or unavailable storage, the extension must fail locally before sending the upstream request.

On ordinary VS Code Stable and Insiders installs, assume the proposed constructor is unavailable or insufficient. The safety decision remains the built-in disable list plus replay-store preflight.

## External Review Outcome

Opus 4.7 reviewed the replay options in three rounds. The review supports the implementation direction used by this report:

- Extension-owned replay is the right v1 path.
- Relying on `LanguageModelThinkingPart` is not sufficient and is not Marketplace-safe.
- An external proxy or MCP transport can work, but it pushes correctness outside the extension and is not the right v1 path.
- `cache miss -> applyDisableThinking()` alone is not guaranteed safe, because upstream may reject historical assistant `tool_calls` messages that lack `reasoning_content` regardless of the current request's `enable_thinking` value.
- On replay miss, fail locally before sending any upstream request.
- Do not sanitize or strip unmatched assistant/tool history in v1, because an unmatched assistant tool-call turn may be valid non-thinking history.

This report treats `localPlaintext` persistence and restart continuity as baseline default v1 requirements. The `memory` backend is an explicit storage opt-in for users who accept losing restart continuity.

## Requirements

### Functional Requirements

1. Users can opt affected models into thinking by configuring:

```jsonc
"infiniai.enableThinkingRoundTripForModels": [
	"mimo-v2*",
	"deepseek-v4*"
]
```

2. For opted-in models, the extension allows thinking only when it can replay all required historical assistant tool-call reasoning content.

3. The extension captures exact structured upstream reasoning content while processing the streaming response.

4. The extension associates captured reasoning content with emitted tool call IDs.

5. The extension injects saved `reasoning_content` into matching future assistant messages before sending the next request upstream.

6. If any assistant tool-call message needs replay but no matching reasoning content exists, the extension fails locally and does not send the upstream request.

7. When the opt-in setting is absent, the existing force-disable behavior remains unchanged.

8. For opted-in models using the default `localPlaintext` backend, replay data survives VS Code window reloads and process restarts while the local plaintext cache entry remains within TTL and size bounds.

9. Users can explicitly select the `memory` backend when they do not want replay data written to disk:

```jsonc
"infiniai.thinkingReplayStore": "memory"
```

10. With the `memory` backend, replay data is process-local and restart continuity is intentionally not supported.

### Non-Functional Requirements

1. The replay store must use a local plaintext persistent backend by default once a model is opted into `infiniai.enableThinkingRoundTripForModels`.
2. The replay store must also support an explicit `memory` backend.
3. Both backends must keep an in-memory index for request-time lookup and preflight.
4. Both backends must be bounded by entry count, byte size, and TTL.
5. Reasoning content must never be logged.
6. Reasoning content must never be written to `workspaceState`, `globalState`, `SecretStorage`, telemetry, or diagnostics.
7. Plaintext persistence must use VS Code extension storage files, not VS Code settings or mementos.
8. The `memory` backend must not write replay data to disk.
9. The implementation must not require `LanguageModelThinkingPart`.
10. The implementation must work on VS Code Stable.
11. The implementation must preserve the current safe default for affected models when the model opt-in setting is absent.
12. The implementation must provide a command to clear the active thinking replay cache.

## Non-Goals

This design does not implement:

- Encryption at rest for replay cache entries.
- Sanitizing or rewriting historical tool-call turns on replay miss.
- Displaying reasoning content in the VS Code UI.
- Depending on `LanguageModelThinkingPart` for correctness.
- Enabling thinking by default for `mimo-v2*` or `deepseek-v4*`.
- External proxy or MCP-based replay.
- Additional replay backends beyond `localPlaintext` and `memory` in v1.

## Configuration UX Guidance

The `infiniai.enableThinkingRoundTripForModels` setting must be described as experimental, best-effort, and heuristic. It should not sound like a general promise that every matching model or existing chat will work.

Recommended `package.nls.json` description:

```json
"configuration.enableThinkingRoundTripForModels.description": "Experimental, best-effort opt-in list of model ID patterns whose thinking-mode reasoning_content should be captured and replayed for tool-call conversations, for example 'mimo-v2*' or 'deepseek-v4*'. Pattern matching is heuristic; supports '*' wildcards and is case-insensitive. Enabling a model does not guarantee every chat can continue: the extension sends thinking-enabled requests only when it can replay the required reasoning_content, otherwise it fails locally to avoid upstream HTTP 400. Replay storage is controlled by infiniai.thinkingReplayStore."
```

If the configuration contribution uses `markdownDescription`, prefer backticks around setting names and protocol fields:

```json
"markdownDescription": "Experimental, best-effort opt-in list of model ID patterns whose thinking-mode `reasoning_content` should be captured and replayed for tool-call conversations, for example `mimo-v2*` or `deepseek-v4*`. Pattern matching is heuristic; supports `*` wildcards and is case-insensitive. Enabling a model does not guarantee every chat can continue: the extension sends thinking-enabled requests only when it can replay the required `reasoning_content`, otherwise it fails locally to avoid upstream HTTP 400. Replay storage is controlled by `infiniai.thinkingReplayStore`."
```

The localized Chinese description should preserve the same contract:

- Experimental and best-effort.
- Pattern matching is heuristic.
- The setting targets model ID patterns, not a guaranteed model support matrix.
- The extension may fail locally instead of sending an unsafe upstream request.
- Replay storage behavior is controlled separately by `infiniai.thinkingReplayStore`.

## Current Code Reference

Current request conversion:

- `src/openai/openaiApi.ts`: `OpenaiApi.convertMessages(...)` builds OpenAI-compatible messages from VS Code language-model messages.
- It can currently set `assistantMessage.reasoning_content` only when incoming VS Code history contains `LanguageModelThinkingPart`.

Current streaming reasoning capture point:

- `src/openai/openaiApi.ts`: `processDelta(...)` reads:
  - `choice.thinking`
  - `delta.thinking`
  - `delta.reasoning_content`
  - `delta.reasoning_details`
- It currently forwards parsed thinking text into `bufferThinkingContent(...)`.

Current thinking emission behavior:

- `src/commonApi.ts`: `bufferThinkingContent(...)` emits `LanguageModelThinkingPart` only when the proposed constructor exists.
- On Stable, the thinking text is effectively dropped.

Current request guard:

- `src/openai/openaiApi.ts`: `prepareRequestBody(...)` computes:

```ts
const forceDisableThinking = shouldDisableThinking(modelId, getDisableThinkingPatterns());
const userOptedIntoRoundTrip = shouldEnableThinkingRoundTrip(modelId, getThinkingRoundTripPatterns());
const allowThinkingRoundTrip =
	userOptedIntoRoundTrip &&
	!!getThinkingPartCtor() &&
	isKnownThinkingRoundTripSafeRequest();

if (forceDisableThinking && !allowThinkingRoundTrip) {
	applyDisableThinking(orb);
}
```

Current conservative predicate:

- `src/thinkingMode.ts`: `isKnownThinkingRoundTripSafeRequest()` returns `false`.

This report replaces the conceptual meaning of `allowThinkingRoundTrip`: it should depend on a real replay-store preflight result, not on proposed API constructor availability.

## Recommended Architecture

Add a new module:

```text
src/thinkingReplayStore.ts
```

The module owns an extension-local replay store with:

- An in-memory index used during request preflight.
- A `localPlaintext` persistent backend used to survive VS Code restarts.
- A `memory` backend used when the user explicitly opts out of disk persistence.
- TTL, LRU, and byte-size pruning.

For `localPlaintext`, use VS Code extension storage files for persistence. Prefer `ExtensionContext.storageUri` when available so the cache is workspace-scoped. Fall back to `ExtensionContext.globalStorageUri` for no-workspace windows.

For `memory`, use the same store interface with a no-op persistence backend. Replay entries remain process-local and are lost on extension host restart, VS Code reload, or process exit.

Suggested public interface:

```ts
export interface ThinkingReplayEntry {
	readonly modelId: string;
	readonly callId: string;
	readonly reasoningContent: string;
	readonly capturedAt: number;
	readonly byteLength: number;
}

export interface PendingThinkingTurn {
	readonly turnId: string;
	readonly modelId: string;
}

export class ThinkingReplayStore {
	initialize(storage: ThinkingReplayStorage): Promise<void>;
	beginTurn(modelId: string): PendingThinkingTurn;
	appendReasoning(turnId: string, text: string): void;
	recordToolCall(turnId: string, callId: string): void;
	commit(turnId: string): Promise<void>;
	abort(turnId: string): void;
	lookup(modelId: string, callId: string): ThinkingReplayEntry | undefined;
	prune(now?: number): Promise<void>;
	clear(): Promise<void>;
}
```

Recommended singleton helper:

```ts
export const thinkingReplayStore = new ThinkingReplayStore();
```

Suggested storage abstraction:

```ts
export interface ThinkingReplayStorage {
	load(): Promise<readonly ThinkingReplayEntry[]>;
	save(entries: readonly ThinkingReplayEntry[]): Promise<void>;
	clear(): Promise<void>;
}

export class LocalPlaintextThinkingReplayStorage implements ThinkingReplayStorage {
	constructor(private readonly storageFile: vscode.Uri) {}
}

export class MemoryThinkingReplayStorage implements ThinkingReplayStorage {
	load(): Promise<readonly ThinkingReplayEntry[]> {
		return Promise.resolve([]);
	}

	save(_entries: readonly ThinkingReplayEntry[]): Promise<void> {
		return Promise.resolve();
	}

	clear(): Promise<void> {
		return Promise.resolve();
	}
}
```

The `localPlaintext` storage file should be versioned JSON, for example:

```jsonc
{
	"version": 1,
	"entries": [
		{
			"modelId": "mimo-v2.5-pro",
			"callId": "call_abc",
			"reasoningContent": "...",
			"capturedAt": 1778841600000,
			"byteLength": 1234
		}
	]
}
```

Writes should be atomic: write a temporary file, then rename or replace the target file. If loading fails because the file is missing, corrupt, or too large, ignore the cache, start with an empty store, and log only sanitized metadata.

### Replay Backend Contract

The v1 backend setting is:

```jsonc
"infiniai.thinkingReplayStore": "localPlaintext"
```

Supported values:

```ts
type ThinkingReplayStoreMode = "localPlaintext" | "memory";
```

`localPlaintext` is the default. `memory` is an explicit opt-in for users who accept no restart continuity.

Shared implementation rules:

1. `infiniai.enableThinkingRoundTripForModels` must still match the model. Choosing a replay store does not enable thinking by itself.
2. Both backends use the same replay preflight, strict fail-local policy, keying, TTL, LRU, and byte-size limits.
3. Both backends must support the clear-cache command.
4. Never store replay data in VS Code settings, `workspaceState`, `globalState`, or `SecretStorage`.

`localPlaintext` rules:

1. Load the local plaintext replay file during extension activation, or lazily before the first request that may use the replay store.
2. Store the file at `thinking-replay-v1.json` below `ExtensionContext.storageUri` when available.
3. Use `ExtensionContext.globalStorageUri` only when there is no workspace storage URI.
4. Save committed entries after successful thinking tool-call turns.
5. Save the pruned entry set after TTL, LRU, or byte-size cleanup.
6. Delete or truncate the file when the user runs the clear-cache command.
7. A chat that produced a thinking tool-call turn before restart must be able to continue after restart if the matching replay entries are still present and valid.
8. The first post-restart request must load the persisted cache before replay preflight runs.
9. If the cache entry is missing, expired, corrupt, oversized, or scoped to a different storage location, the extension must fail locally before sending the upstream request.

`memory` rules:

1. Do not create, read, or write a replay cache file for active replay operation.
2. Keep committed replay entries only in process memory.
3. Clear all replay entries on extension host restart, VS Code window reload, or process exit.
4. When switching to `memory`, delete any prior `localPlaintext` cache file if it exists so the opt-in removes stale disk state.
5. After restart or reload, continuing a thinking tool-call conversation with historical assistant tool calls should fail locally because the replay entries no longer exist.

### Keying

Use:

```text
${modelId}::${toolCallId}
```

Rationale:

- `tool_call.id` is the strongest join key available from the OpenAI-compatible protocol.
- VS Code must preserve `LanguageModelToolCallPart.callId` well enough to correlate tool results.
- `modelId` prevents cross-model contamination.
- Content hashing of tool name and arguments is unsafe for v1 because repeated identical tool calls are common.

If `tool_call.id` / `callId` is missing, treat the turn as unreplayable and fail locally when thinking is enabled.

### Store Bounds

Recommended defaults:

- Max committed entries: `500`
- Max committed total bytes: `2 MB`
- Max pending turn bytes: `512 KB`
- TTL: `24 hours`

If a pending turn exceeds the per-turn byte limit, mark it unreplayable and abort it rather than storing truncated reasoning. Truncated `reasoning_content` is not safe replay data.

## Request Lifecycle

### 1. Preflight Before Sending

In `runOpenAIRequest(...)`, after `convertMessages(...)` builds `openaiMessages`, run a replay preflight before `prepareRequestBody(...)`.

The preflight result should include:

```ts
interface ThinkingReplayPreflight {
	readonly messages: OpenAIChatMessage[];
	readonly allRequiredReasoningReplayed: boolean;
	readonly replayedCount: number;
	readonly missingCallIds: readonly string[];
}
```

The preflight walks OpenAI assistant messages:

1. For each assistant message with `tool_calls`, inspect every `tool_call.id`.
2. Lookup `${modelId}::${tool_call.id}` in the replay store.
3. If all tool calls in that assistant message map to the same reasoning blob, attach that blob as `assistant.reasoning_content`.
4. If any tool call is missing, mark the request as unreplayable.
5. If two tool calls on the same assistant message map to different reasoning blobs, mark the request as unreplayable. This indicates fragmented or corrupted history that v1 should not guess around.

### 2. Deciding Whether Thinking Is Allowed

Replace the current constructor-based allow predicate with replay preflight:

```ts
const forceDisableThinking = shouldDisableThinking(modelId, getDisableThinkingPatterns());
const userOptedIntoRoundTrip = shouldEnableThinkingRoundTrip(modelId, getThinkingRoundTripPatterns());
const allowThinkingRoundTrip =
	userOptedIntoRoundTrip &&
	replayPreflight.allRequiredReasoningReplayed;

if (forceDisableThinking && !allowThinkingRoundTrip) {
	applyDisableThinking(orb);
}
```

However, this alone is not enough. If `userOptedIntoRoundTrip` is true and the outgoing messages contain assistant tool calls with missing replay data, the request must fail locally before it is sent.

### 3. Fail-Local Policy

Fail locally when all of the following are true:

1. The model matches `infiniai.enableThinkingRoundTripForModels`.
2. The request is not force-disabled by user choice.
3. The outgoing message history contains at least one assistant message with `tool_calls`.
4. At least one such tool call lacks matching replay data.

The extension should not send the upstream request.

Suggested error text:

```text
Reasoning cannot be resumed for this conversation because prior tool-call reasoning context is not available. This can happen after cache expiry, clearing the replay cache, switching models, switching storage scopes, or enabling reasoning mid-chat. Start a new chat to use reasoning with this model, or remove the reasoning opt-in to continue this chat without thinking.
```

This should surface in the chat response stream as a provider error, not as an upstream HTTP error.

### 4. Streaming Capture

When a request is allowed to think, create a pending turn:

```ts
const pendingTurn = thinkingReplayStore.beginTurn(model.id);
```

Pass the pending turn into `OpenaiApi`.

During `processDelta(...)`, append structured reasoning fragments to the pending turn whenever the extension observes:

- `choice.thinking`
- `delta.thinking`
- `delta.reasoning_content`
- `delta.reasoning_details`

Do not capture XML `<think>` blocks from `delta.content` in v1. They are presentation text, not the upstream structured `reasoning_content` contract.

When a tool call is emitted to VS Code, record the tool call ID against the same pending turn.

Commit the pending turn only if:

1. The stream reaches `finish_reason === "tool_calls"`.
2. At least one tool call ID was recorded.
3. The pending turn has non-empty reasoning content.
4. The pending turn did not exceed byte limits.

Abort the pending turn on:

- Cancellation.
- Stream parse error.
- Network error.
- `finish_reason === "stop"`.
- No tool calls.
- Missing call IDs.
- Empty reasoning content.

## Why Not Sanitize on Replay Miss

Sanitizing means removing assistant tool-call messages and paired tool messages from outgoing history when replay data is missing.

This is not recommended for v1.

Reasons:

1. An unmatched assistant tool-call turn might be valid non-thinking history.
2. Removing it silently distorts the user's conversation context.
3. The extension cannot reliably know whether an unmatched turn was generated in thinking mode.
4. Silent context loss is harder for users to understand than a local actionable error.

Sanitization can be revisited later as an explicit recovery mode, for example:

```jsonc
"infiniai.thinkingReplayRecovery": "fail" // future: "sanitize"
```

It should not be the default behavior.

## Privacy and Security

`reasoning_content` may include sensitive user prompts, code, file paths, API names, or business logic. It must be treated as transient sensitive data.

The v1 product decision has two opt-in layers:

1. `infiniai.enableThinkingRoundTripForModels` opts model families into thinking round-trip.
2. `infiniai.thinkingReplayStore` selects the replay storage behavior.

Default storage behavior is `localPlaintext`, because restart continuity is important for the normal product experience. Users who do not want disk persistence can explicitly choose `memory` and accept that restart continuity is unavailable.

Rules:

- Do not log `reasoning_content`.
- Persist `reasoning_content` only when the selected replay backend is `localPlaintext`.
- Do not persist `reasoning_content` when the selected replay backend is `memory`.
- Do not expose `reasoning_content` in diagnostics.
- Do not include `reasoning_content` in telemetry.
- Do not write it to VS Code `workspaceState`, `globalState`, settings, logs, telemetry, or `SecretStorage`.
- Do not sync it across machines.
- Provide a command to clear the active thinking replay cache.
- Clear pending turns on abort.
- Prune committed entries by TTL and LRU bounds.
- For `localPlaintext`, save the pruned entry set to disk.

Diagnostics may include:

- Model ID.
- Whether thinking was opted in.
- Whether replay hit or missed.
- Number of replayed tool-call turns.
- Number of missing tool call IDs.
- Store size and byte count.

Diagnostics must not include:

- Reasoning text.
- Tool arguments.
- Tool results.
- User prompt text.

## Implementation Plan

### Phase 1: Store Module

Add `src/thinkingReplayStore.ts` with:

- Pending turn lifecycle.
- Replay backend initialization.
- `appendReasoning(...)`.
- `recordToolCall(...)`.
- `commit(...)`.
- `abort(...)`.
- `lookup(...)`.
- TTL and LRU pruning.
- Byte limits.
- Atomic persisted-cache writes for `localPlaintext`.
- No-op persistence for `memory`.
- Clear-cache support.

Add focused unit tests for:

- Commit and lookup.
- Abort removes pending data.
- Missing call ID is unreplayable.
- TTL pruning.
- LRU pruning.
- Byte-limit abort.
- Local plaintext persistence load/save.
- Memory backend load/save/clear performs no disk I/O.
- Corrupt persisted cache is ignored safely.
- Clear-cache removes persisted entries.

### Phase 2: OpenAI Streaming Capture

Wire `OpenaiApi` so it can receive an optional pending replay turn.

Capture structured reasoning fragments where `processDelta(...)` already handles thinking content.

Record tool call IDs when tool calls are emitted.

Commit only when `finish_reason === "tool_calls"` and all commit conditions pass.

Abort in all other terminal/error paths.

### Phase 3: Replay Preflight

Add a replay preflight function for OpenAI messages.

Suggested file:

```text
src/thinkingReplay.ts
```

Suggested function:

```ts
export function applyThinkingReplay(input: {
	modelId: string;
	messages: readonly OpenAIChatMessage[];
	store: ThinkingReplayStore;
}): ThinkingReplayPreflight;
```

The function returns a new message array and does not mutate the original.

### Phase 4: Request Guard Integration

Update `runOpenAIRequest(...)`:

1. Convert messages.
2. Run replay preflight.
3. If opted in and replay miss exists, fail locally.
4. Use preflight messages in the request body.
5. Allow thinking only when opt-in and replay preflight succeeded.
6. Otherwise keep existing disable behavior.

Update `prepareRequestBody(...)` so it no longer depends on `getThinkingPartCtor()` for round-trip safety.

### Phase 5: Proposed API Decoupling

Once replay-store support exists, `LanguageModelThinkingPart` is no longer needed for correctness.

For Marketplace release, consider removing:

```jsonc
"enabledApiProposals": [
	"languageModelThinkingPart"
]
```

The extension can later add an Insiders-only display feature separately, but display should not be required for replay correctness.

### Phase 6: Documentation

Update README and Chinese README:

- Explain that thinking opt-in uses `localPlaintext` replay storage by default.
- Explain that users can choose `memory` when they do not want disk persistence and accept no restart continuity.
- Explain that VS Code restarts can continue the conversation only with `localPlaintext` when the replay cache is still available.
- Explain that replay misses fail locally to prevent upstream 400s.
- Explain TTL/LRU cleanup and the clear-cache command.
- State that reasoning content is never logged or sent to telemetry.

Update changelog under a new version entry.

## Test Plan

### Store Tests

1. `beginTurn -> appendReasoning -> recordToolCall -> commit -> lookup` returns exact reasoning content.
2. `abort` removes pending reasoning and call IDs.
3. `commit` without call IDs stores nothing.
4. `commit` without reasoning stores nothing.
5. TTL expiration removes entries.
6. LRU cap removes old entries.
7. Byte cap aborts or rejects oversized turns without truncating.
8. Store persists entries to local plaintext JSON.
9. Store reloads entries after restart initialization.
10. Corrupt or oversized persisted cache starts empty and logs only sanitized metadata.
11. Memory backend does not persist replay entries and clears any prior local plaintext cache file when selected.
12. Clear-cache removes memory and disk state for `localPlaintext`.
13. Clear-cache removes memory state for `memory`.

### Streaming Tests

1. Stream fixture with `delta.reasoning_content`, tool call chunks, and `finish_reason: "tool_calls"` commits the reasoning.
2. Stream fixture with `choice.thinking` commits the reasoning.
3. Stream fixture with `delta.thinking` commits the reasoning.
4. Stream fixture with `reasoning_details` commits the normalized detail text.
5. Stream fixture with XML `<think>` in `delta.content` does not commit replay reasoning in v1.
6. Cancellation aborts pending turn.
7. Stream parse error aborts pending turn.
8. `finish_reason: "stop"` aborts pending turn.

### Replay Preflight Tests

1. Assistant `tool_calls` with matching store entry gets `reasoning_content`.
2. Multiple tool calls in one assistant message with same stored reasoning get one `reasoning_content`.
3. Missing `tool_call.id` marks request unreplayable.
4. Missing store entry marks request unreplayable.
5. Two tool calls in one assistant message mapping to different reasoning entries marks request unreplayable.
6. Non-tool assistant messages are unchanged.
7. Tool messages are unchanged.
8. Original messages are not mutated.

### Request Guard Tests

1. `mimo-v2-pro` without opt-in stays disabled.
2. `deepseek-v4*` without opt-in stays disabled.
3. Opt-in with no assistant tool-call history allows thinking on a new chat.
4. Opt-in with full replay hit allows thinking and sends `reasoning_content`.
5. Opt-in with replay miss fails locally before fetch.
6. Opt-in with `localPlaintext` after VS Code restart succeeds when the local replay cache still contains matching entries.
7. Opt-in with `memory` after VS Code restart fails locally for old tool-call history.
8. User removes opt-in and the extension returns to force-disable behavior.
9. No outgoing request is sent in fail-local paths.

### Regression Invariant

Add a test helper that asserts:

```text
If an outgoing request for an affected thinking model is sent with thinking enabled,
then every assistant message with tool_calls must include reasoning_content.
```

This invariant is the core safety guarantee.

## Manual Verification

### Stable VS Code

1. Install the built VSIX in VS Code Stable.
2. Configure:

```jsonc
"infiniai.enableThinkingRoundTripForModels": [
	"mimo-v2*",
	"deepseek-v4*"
]
```

3. Start a new chat with `mimo-v2.5-pro`.
4. Ask a prompt that triggers tool use.
5. Continue the tool-call conversation.
6. Verify no HTTP 400 occurs.
7. Verify logs show replay hit and thinking enabled.

### Replay Miss

1. Start a thinking-enabled tool-call chat.
2. Clear the local thinking replay cache, or wait until the relevant entry expires.
3. Continue the same chat.
4. Verify the extension fails locally with the clear replay-miss message.
5. Verify no upstream request is sent.

### Restart Continuity

1. Start a thinking-enabled tool-call chat.
2. Continue once to verify replay works before restart.
3. Reload VS Code window.
4. Continue the same chat while the cache is still within TTL.
5. Verify the extension replays persisted `reasoning_content` and no HTTP 400 occurs.

### Memory Backend

1. Configure:

```jsonc
"infiniai.enableThinkingRoundTripForModels": [
	"mimo-v2*",
	"deepseek-v4*"
],
"infiniai.thinkingReplayStore": "memory"
```

2. Start a thinking-enabled tool-call chat.
3. Continue once before restart and verify replay works.
4. Verify no `thinking-replay-v1.json` file is created.
5. Reload VS Code window.
6. Continue the same chat.
7. Verify the extension fails locally with the clear replay-miss message.
8. Verify no upstream request is sent.

### Non-Opt-In

1. Remove `infiniai.enableThinkingRoundTripForModels`.
2. Use `mimo-v2.5-pro` with a tool-call prompt.
3. Verify request body includes `enable_thinking: false` and `thinking: { type: "disabled" }`.
4. Verify no 400 occurs.

## Open Questions

1. Should the error be emitted as a markdown chat response, thrown provider error, or actionable error with buttons?
2. Should a one-time warning explain that thinking replay stores local plaintext cache entries?
3. Should TTL be 30 minutes or 24 hours? The recommendation is 24 hours with byte caps.
4. Should `LanguageModelThinkingPart` be removed immediately for Marketplace release, or kept until a separate Marketplace-safe package path is prepared?
5. Should the `memory` backend show a one-time warning that thinking tool-call conversations cannot be resumed after VS Code reload or restart?

## Sign-Off Decision

The signed-off v1 design is:

```text
extension-owned replay store
+ default localPlaintext backend
+ explicit memory backend opt-in for no disk persistence
+ in-memory request-time index
+ key by modelId and toolCallId
+ capture structured reasoning only
+ inject exact reasoning_content on replay hit
+ fail locally on replay miss
+ no sanitization by default
+ no encryption in v1
+ no proposed API dependency for correctness
```

This is the first implementation that can safely make `infiniai.enableThinkingRoundTripForModels` effective for `mimo-v2*` and `deepseek-v4*` without reintroducing the HTTP 400 failure mode.
