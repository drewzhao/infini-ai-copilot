# InfiniAI `reasoning_content` HTTP 400 Root Cause Report

Date: 2026-05-15

## Executive Summary

The HTTP 400 is expected from the upstream thinking-mode API contract. When a thinking-mode assistant turn performs tool calls, the next request must include that assistant turn's `reasoning_content`. If the VS Code/Copilot Chat flow sends the assistant tool-call turn back without `reasoning_content`, InfiniAI rejects the request with:

```text
The reasoning_content in the thinking mode must be passed back to the API.
```

The root cause is in the InfiniAI VS Code extension's integration strategy, not in a simple VS Code source regression:

1. VS Code stable cannot expose `LanguageModelThinkingPart`, so it cannot be relied on to round-trip thinking content.
2. VS Code Insiders can expose `LanguageModelThinkingPart` through the proposed Language Model API transport, but that does not prove the Copilot Chat participant history path will preserve thinking parts and pass them back to the provider on later turns.
3. InfiniAI Copilot 0.5.3 treats `LanguageModelThinkingPart` availability as an end-to-end round-trip guarantee and skips the thinking-disable fallback when the constructor exists.
4. The local Insiders user setting also overrides the default disable list and omits `mimo-v2.5-pro`, so `mimo-v2.5-pro` is not protected by the fallback when that fallback is used.

The stable-safe fix is to disable thinking for affected stateful tool-call thinking models before sending requests. The Insiders-safe fix is the same by default. A setting such as `infiniai.enableThinkingRoundTripForModels` can be defined for both stable and Insiders, but it is only effective when the extension has a real round-trip backend: VS Code host thinking-part transport on verified Insiders paths, or an extension-owned `reasoning_content` store on stable.

## Observed Error

VS Code Insiders 1.121.0-insider with InfiniAI Copilot 0.5.3 fails with:

```text
HTTP 400 Bad Request: {"error":{"code":"400","message":"Param Incorrect","param":"The reasoning_content in the thinking mode must be passed back to the API.","type":""}}
```

The captured stack shows the installed extension posts an OpenAI-compatible chat completion request and receives the 400:

```text
readHttpErrorResponse (.../drewzhao.infiniai-copilot-0.5.3/out/utils.js:191:12)
InfiniAIChatModelProvider.runOpenAIRequest (.../drewzhao.infiniai-copilot-0.5.3/out/provider.js:361:26)
InfiniAIChatModelProvider.provideLanguageModelChatResponse (.../drewzhao.infiniai-copilot-0.5.3/out/provider.js:155:17)
```

Local evidence also shows the affected chat session used `mimo-v2.5-pro` and later recorded the exact `reasoning_content` 400 error.

## Upstream API Contract

The DeepSeek thinking-mode documentation describes the same OpenAI-compatible behavior InfiniAI is enforcing:

- Thinking mode returns chain-of-thought data through `reasoning_content`, alongside normal `content`.
- For normal multi-turn requests without tool calls, previous `reasoning_content` may be omitted.
- For tool-call turns in thinking mode, the assistant `reasoning_content` must be passed back in subsequent requests.
- If code does not pass `reasoning_content` back correctly, the API returns HTTP 400.

Source: <https://api-docs.deepseek.com/guides/thinking_mode>

This matches the observed failure: a previous assistant turn was generated in thinking mode, the conversation proceeded through a tool-call loop, and the subsequent request did not include the required assistant `reasoning_content`.

## Extension Evidence

InfiniAI Copilot 0.5.3 has two mechanisms related to thinking content.

First, `src/openai/openaiApi.ts` tries to replay reasoning only when VS Code supplies thinking parts in the incoming language-model messages:

```ts
const ThinkingPartCtor = getThinkingPartCtor();
// ...
} else if (ThinkingPartCtor && part instanceof ThinkingPartCtor) {
	const v = (part as vscode.LanguageModelThinkingPart).value;
	thinkingTexts.push(Array.isArray(v) ? v.join("") : v);
}
// ...
if (thinkingTexts.length > 0) {
	assistantMessage.reasoning_content = thinkingTexts.join("");
}
```

Second, `src/commonApi.ts` streams thinking parts back to VS Code only when the proposed constructor exists:

```ts
const Ctor = getThinkingPartCtor();
if (Ctor && progress) {
	progress.report(new Ctor(text, this._currentThinkingId) as unknown as vscode.LanguageModelResponsePart);
}
```

Third, `src/openai/openaiApi.ts` disables thinking only if the proposed constructor is not available:

```ts
const modelId = um?.id ?? (typeof orb.model === "string" ? orb.model : "");
if (!getThinkingPartCtor() && shouldDisableThinking(modelId, getDisableThinkingPatterns())) {
	applyDisableThinking(orb);
}
```

That condition is the fragile assumption. If Insiders exposes `LanguageModelThinkingPart`, 0.5.3 skips `applyDisableThinking()` even for known affected models.

The default model patterns are also exact except where `*` is explicit:

```ts
[
	"mimo-v2-pro",
	"mimo-v2.5-pro",
	"mimo-v2.5",
	"mimo-v2-omni",
	"mimo-v2-flash",
	"deepseek-v4*",
]
```

`getDisableThinkingPatterns()` reads the user setting as a replacement value:

```ts
return cfg.get<string[]>("disableThinkingForModels", [...DEFAULT_DISABLE_THINKING_PATTERNS]);
```

So a user-defined list does not add to the defaults; it replaces them.

## VS Code Source Evidence

The local VS Code source at `/Users/yinghaozhao/code/github/vscode` is on `main` and was behind `origin/main` during inspection, so treat it as architecture evidence rather than an exact release snapshot. The installed local versions observed during this investigation were:

- VS Code stable: `1.120.0`
- VS Code Insiders: `1.121.0-insider`

The source shows two different layers.

### Language Model Transport Supports Thinking

`src/vscode-dts/vscode.proposed.languageModelThinkingPart.d.ts` defines `LanguageModelThinkingPart` and includes it in `LanguageModelChatResponse.stream` and `LanguageModelChatMessage2.content`.

`src/vs/workbench/api/common/extHostLanguageModels.ts` also maps provider progress fragments of type `LanguageModelThinkingPart` into internal `type: 'thinking'` response parts, and maps internal `type: 'thinking'` response parts back into `LanguageModelThinkingPart` for language-model response streams.

This means the proposed LM API transport can carry thinking parts.

### Chat Participant History Does Not Expose Thinking

The regular chat participant history API is narrower:

- `src/vscode-dts/vscode.d.ts` defines `ChatResponseTurn.response` as only markdown, file tree, anchor, and command button parts.
- `src/vs/workbench/api/common/extHostChatAgents2.ts` builds history turns with `typeConvert.ChatResponsePart.toContent(...)`.
- `src/vs/workbench/api/common/extHostTypeConverters.ts` converts only markdown, inline references, file trees, and commands into `ChatResponseTurn` content. There is no thinking response part in that exposed chat history type.

Therefore Insiders proposed LM transport support is not the same as an end-to-end guarantee that Copilot Chat agents will reconstruct and resend InfiniAI's `reasoning_content` on future `model.sendRequest(...)` calls.

## Local Configuration Evidence

The current Insiders user settings contain:

```jsonc
"infiniai.disableThinkingForModels": [
	"mimo-v2.5",
	"mimo-v2-omni",
	"mimo-v2-flash",
	"deepseek-v4*"
]
```

This replaces the extension defaults and omits:

- `mimo-v2-pro`
- `mimo-v2.5-pro`

Because matching is exact unless the pattern includes `*`, `mimo-v2.5` does not match `mimo-v2.5-pro`.

This is a concrete local contributor for `mimo-v2.5-pro`: whenever the fallback path is active, the configured list does not disable thinking for that model. On Insiders where `LanguageModelThinkingPart` is exposed, the fallback is skipped regardless of this list.

## Root Cause

The 400 happens when these conditions combine:

1. A model with stateful thinking/tool-call semantics is used, such as `mimo-v2.5-pro` or DeepSeek V4-family models.
2. The upstream emits `reasoning_content` during a tool-call turn.
3. The subsequent OpenAI-compatible request contains the assistant/tool-call history but not the assistant `reasoning_content`.
4. InfiniAI Copilot 0.5.3 did not force-disable thinking for that request.

The design-level bug is that the extension assumes:

```text
host exposes LanguageModelThinkingPart => reasoning_content can be round-tripped safely
```

That assumption is too broad. VS Code Insiders can carry thinking parts through the proposed LM transport, but the Copilot Chat participant history path still does not expose thinking as normal response history. The extension should treat proposed thinking-part support as an optional optimization for proven call paths, not as a reason to leave thinking enabled by default for models that require exact `reasoning_content` replay.

## Is This a VS Code Stable Bug?

No. Stable VS Code does not provide the proposed `LanguageModelThinkingPart` API. The extension already recognizes this limitation and has a stable fallback that disables thinking for affected models.

The stable problem is that the fallback is pattern-driven and can be bypassed by configuration or incomplete model IDs. Stable cannot safely run thinking mode for these affected tool-call models unless the extension owns an independent conversation store that preserves and resends the exact upstream `reasoning_content`.

## Is This a VS Code Insiders Bug?

Not from the inspected source evidence.

Insiders exposes the proposed LM transport for thinking parts, and that part appears internally consistent. The missing guarantee is at the chat participant history layer: `ChatResponseTurn` is content-oriented and does not expose thinking parts back to chat agents as normal history.

So the extension should not rely on Insiders alone to solve this. The extension needs a conservative default and an explicit opt-in path for any environment where thinking round-trip has actually been verified end to end.

## Can the Round-Trip Opt-In Apply to Stable?

Yes as a configuration surface, but not through VS Code stable host APIs alone.

The setting can be cross-host:

```jsonc
"infiniai.enableThinkingRoundTripForModels": []
```

However, "enabled" must mean "there is a working replay mechanism", not merely "the user opted in". There are two possible replay mechanisms:

1. Host transport replay: available only when `getThinkingPartCtor()` returns a constructor and the request path is known to preserve thinking parts.
2. Extension-owned replay: available on stable or Insiders only if InfiniAI Copilot stores upstream `reasoning_content` itself and injects it into later OpenAI request history.

Evidence from extension code:

- `src/proposedApi.ts` says `getThinkingPartCtor()` returns `undefined` on stable VS Code without proposed API support.
- `src/commonApi.ts` emits thinking content to VS Code only when `getThinkingPartCtor()` returns a constructor.
- `src/openai/openaiApi.ts` reconstructs OpenAI `assistant.reasoning_content` only when the incoming VS Code message contains thinking parts.

Therefore, on stable VS Code, `infiniai.enableThinkingRoundTripForModels` can be accepted and logged, but it must not leave thinking enabled unless the extension has its own reasoning-content store. Without that store, stable has no source for the exact `reasoning_content` required by the upstream API.

Recommended semantic contract:

- The setting is available on stable and Insiders.
- On Insiders, it allows thinking only when host thinking-part replay is verified for the current path.
- On stable, it allows thinking only when extension-owned replay is implemented and available for the current request.
- Once extension-owned replay exists, the replay backend should default to local plaintext persistence for opted-in models.
- Users who do not want disk persistence should be able to opt into a `memory` replay backend and accept that thinking tool-call conversations may not continue after VS Code reload or restart.
- If the user opts in but no replay backend is available, the extension should keep thinking disabled and log a diagnostic explaining why.

## Recommended Fix for Stable VS Code

Stable should force-disable thinking for affected models before sending the OpenAI-compatible request by default. The only stable exception should be a future extension-owned replay backend that can prove it has saved and can inject the exact upstream `reasoning_content`.

Recommended behavior:

```ts
const modelId = um?.id ?? (typeof orb.model === "string" ? orb.model : "");
if (shouldDisableThinking(modelId, getEffectiveDisableThinkingPatterns())) {
	applyDisableThinking(orb);
}
```

Key details:

- Remove the `!getThinkingPartCtor()` gate for the safety list.
- Use safer default patterns such as `mimo-v2*` and `deepseek-v4*`, or at minimum keep the known exact defaults.
- Treat user settings as additions to the safety defaults, not as a full replacement, unless a separate advanced override setting is introduced.
- Continue setting both upstream variants:

```ts
rb.enable_thinking = false;
rb.thinking = { type: "disabled" };
```

Expected default result on stable: affected models do not generate `reasoning_content` in the first place, so later tool-call turns do not require impossible replay through stable VS Code chat history.

## Recommended Fix for VS Code Insiders

Insiders should use the same conservative default as stable for affected models.

Recommended behavior:

1. `infiniai.disableThinkingForModels` should be a true force-disable list and should win even when `LanguageModelThinkingPart` exists.
2. Thinking round-trip should be opt-in, not inferred only from constructor availability.
3. Add a separate advanced setting, for example:

```jsonc
"infiniai.enableThinkingRoundTripForModels": []
```

Then only leave thinking enabled when all of these are true:

- The host exposes `LanguageModelThinkingPart`.
- The model matches the explicit enable-round-trip list.
- The request path is known to preserve and replay thinking parts end to end.
- Diagnostics confirm converted assistant messages include `reasoning_content` when tool-call history is present.

Conservative request logic:

```ts
const modelId = um?.id ?? (typeof orb.model === "string" ? orb.model : "");
const forceDisable = shouldDisableThinking(modelId, getEffectiveDisableThinkingPatterns());
const allowRoundTrip =
	!!getThinkingPartCtor() &&
	shouldEnableThinkingRoundTrip(modelId, getThinkingRoundTripPatterns()) &&
	isKnownThinkingRoundTripSafeRequest(options);

if (forceDisable && !allowRoundTrip) {
	applyDisableThinking(orb);
}
```

If the extension does not yet have a reliable `isKnownThinkingRoundTripSafeRequest(...)` signal, it should not enable thinking round-trip by default for these models.

## Implementation Reference Code

The implementation should separate three decisions:

1. Is the model in the force-disable safety list?
2. Did the user explicitly opt this model into thinking round-trip?
3. Is there an actual replay backend for this request?

Suggested setting contribution:

```jsonc
"infiniai.enableThinkingRoundTripForModels": {
	"type": "array",
	"default": [],
	"items": {
		"type": "string"
	},
	"description": "Advanced opt-in list for models whose thinking-mode reasoning_content may be round-tripped. Effective only when the host or extension can preserve and replay reasoning_content end to end."
}
```

Suggested helper functions in `src/thinkingMode.ts`:

```ts
export const DEFAULT_ENABLE_THINKING_ROUND_TRIP_PATTERNS: readonly string[] = [];

export function getEffectiveDisableThinkingPatterns(): string[] {
	const cfg = vscode.workspace.getConfiguration("infiniai");
	const user = cfg.get<string[]>("disableThinkingForModels", []);
	return [...new Set([...DEFAULT_DISABLE_THINKING_PATTERNS, ...user])];
}

export function getThinkingRoundTripPatterns(): string[] {
	const cfg = vscode.workspace.getConfiguration("infiniai");
	return cfg.get<string[]>(
		"enableThinkingRoundTripForModels",
		[...DEFAULT_ENABLE_THINKING_ROUND_TRIP_PATTERNS]
	);
}

export function shouldEnableThinkingRoundTrip(modelId: string, patterns: readonly string[]): boolean {
	return shouldDisableThinking(modelId, patterns);
}
```

Suggested request-body logic in `src/openai/openaiApi.ts`:

```ts
const modelId = um?.id ?? (typeof orb.model === "string" ? orb.model : "");

const forceDisableThinking = shouldDisableThinking(modelId, getEffectiveDisableThinkingPatterns());
const userOptedIntoRoundTrip = shouldEnableThinkingRoundTrip(modelId, getThinkingRoundTripPatterns());

const canRoundTripViaHost =
	!!getThinkingPartCtor() &&
	isKnownThinkingRoundTripSafeRequest(options);

const canRoundTripViaExtensionStore =
	this.reasoningContentStore?.canReplayForRequest(requestContext) === true;

const allowThinkingRoundTrip =
	userOptedIntoRoundTrip &&
	(canRoundTripViaHost || canRoundTripViaExtensionStore);

if (forceDisableThinking && !allowThinkingRoundTrip) {
	applyDisableThinking(orb);
}

if (userOptedIntoRoundTrip && !allowThinkingRoundTrip) {
	this.log.warn(
		`Thinking round-trip was requested for ${modelId}, but no verified ` +
		`reasoning_content replay backend is available; thinking remains disabled.`
	);
}
```

For 0.5.3, `canRoundTripViaHost` is not sufficient by itself because the failing path already shows why constructor availability is too broad. The missing predicate is `isKnownThinkingRoundTripSafeRequest(options)`, which should start conservative. If no reliable signal exists, return `false`.

Suggested extension-owned store shape for stable support:

```ts
interface ReasoningContentStore {
	recordAssistantTurn(input: {
		conversationKey: string;
		assistantMessageKey: string;
		reasoningContent: string;
		toolCallIds: readonly string[];
	}): void;

	applyReplay(input: {
		conversationKey: string;
		messages: OpenAIChatMessage[];
	}): {
		messages: OpenAIChatMessage[];
		replayedCount: number;
		missingToolCallReasoningCount: number;
	};

	canReplayForRequest(input: { conversationKey: string }): boolean;
}
```

The store would be populated while parsing streaming chunks that contain `reasoning_content`. Before sending the next request, `applyReplay(...)` would find assistant messages with `tool_calls` and inject the matching saved `reasoning_content`. This is the only way for the opt-in setting to be genuinely effective on stable VS Code.

Latest design decision: because `infiniai.enableThinkingRoundTripForModels` is already explicit opt-in, the replay store should use local plaintext persistence by default for opted-in models, backed by an in-memory request-time index. It should also provide a separate `memory` backend opt-in for users who do not want disk persistence and accept no restart continuity. Both modes should be bounded by TTL, total bytes, and entry count, provide a clear-cache command, and fail locally if a required replay entry is missing.

Until that store exists, stable behavior should be:

```ts
if (userOptedIntoRoundTrip && !getThinkingPartCtor()) {
	log.warn(
		"enableThinkingRoundTripForModels is configured, but stable VS Code " +
		"does not expose LanguageModelThinkingPart and no extension reasoning store is available."
	);
	applyDisableThinking(orb);
}
```

## Immediate Local Mitigation

For stable VS Code, or for Insiders runs where the proposed constructor is not exposed, update the setting to include the affected model family:

```jsonc
"infiniai.disableThinkingForModels": [
	"mimo-v2*",
	"deepseek-v4*"
]
```

For current InfiniAI Copilot 0.5.3 on Insiders, this setting may still be ignored when `LanguageModelThinkingPart` is exposed because the code checks `!getThinkingPartCtor()` before applying it. A code fix is therefore required for the Insiders-safe behavior.

## Diagnostics to Add

Add request diagnostics without logging the actual reasoning text:

- VS Code host version and stable/insiders channel.
- Whether `getThinkingPartCtor()` returned a constructor.
- `options.requestInitiator` when available.
- Selected model id.
- Effective disable-thinking patterns.
- Whether thinking was disabled on the outgoing request.
- Count of assistant messages with `tool_calls`.
- Count of assistant messages with `reasoning_content`.
- Count of assistant messages that have `tool_calls` but lack `reasoning_content`.

The last counter is the most direct preflight signal. If thinking is enabled and an assistant message with tool calls lacks `reasoning_content`, the extension can either disable thinking on the original request path or fail locally with a targeted diagnostic before sending a request that upstream will reject.

## Test Plan

Add or update unit coverage for:

- `mimo-v2*` matches `mimo-v2-pro`, `mimo-v2.5-pro`, `mimo-v2.5`, `mimo-v2-omni`, and `mimo-v2-flash`.
- User-provided disable patterns are unioned with defaults, or an explicit override mode is tested if replacement behavior is intentionally retained.
- `enableThinkingRoundTripForModels` is accepted on stable and Insiders, but does not allow thinking unless a host or extension replay backend is available.
- Stable with no extension-owned reasoning store logs the opt-in diagnostic and still calls `applyDisableThinking()`.
- Insiders with only `getThinkingPartCtor()` available still disables thinking unless the request path is marked round-trip safe.
- `applyDisableThinking()` runs even when a mock `LanguageModelThinkingPart` constructor exists if the model is force-disabled.
- Assistant messages with thinking parts still produce `reasoning_content` in `convertMessages`.
- Assistant tool-call messages without thinking parts are detected by diagnostics.

Manual verification:

1. Stable VS Code 1.120.0, model `mimo-v2.5-pro`, tool-call prompt.
2. VS Code Insiders 1.121.0-insider without proposed API enabled, same prompt.
3. VS Code Insiders 1.121.0-insider with proposed API enabled, same prompt.

Expected result for all three default paths: the request body includes `enable_thinking: false` and `thinking: { "type": "disabled" }` for affected models, and the upstream 400 does not occur.

## Code References

InfiniAI Copilot:

- `src/openai/openaiApi.ts`: message conversion, `reasoning_content` replay, and current `!getThinkingPartCtor()` thinking-disable gate.
- `src/commonApi.ts`: emits streamed thinking parts only when the proposed constructor exists.
- `src/proposedApi.ts`: `getThinkingPartCtor()` runtime capability detection and stable fallback expectation.
- `src/thinkingMode.ts`: default patterns, exact/wildcard matching, settings lookup, and `applyDisableThinking()`.
- `package.json`: `infiniai.disableThinkingForModels` contribution, proposed `infiniai.enableThinkingRoundTripForModels` contribution location, and `enabledApiProposals: ["languageModelThinkingPart"]`.

VS Code:

- `src/vscode-dts/vscode.proposed.languageModelThinkingPart.d.ts`: proposed `LanguageModelThinkingPart` API.
- `src/vs/workbench/api/common/extHostLanguageModels.ts`: LM response transport conversion for `type: 'thinking'`.
- `src/vscode-dts/vscode.d.ts`: `ChatResponseTurn.response` excludes thinking parts.
- `src/vs/workbench/api/common/extHostChatAgents2.ts`: chat history turns are reconstructed through `ChatResponsePart.toContent(...)`.
- `src/vs/workbench/api/common/extHostTypeConverters.ts`: `toContent(...)` has no thinking-part conversion.
