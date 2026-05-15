# VS Code 1.119/1.120 API Changes and Zenmux Copilot Impact Report

Date: 2026-05-15

## Scope

This report reviews VS Code public API and proposed API changes across the two latest stable release windows relevant to the local machine:

- Latest installed stable: VS Code `1.120.0`, commit `0958016b2af9f09bb4257e0df4a95e2f90590f9f`.
- Previous stable patch line: VS Code `1.119.1`, commit `3fe68d450d4918f375c155b26a3a8e08f25b4e92`.
- Previous baseline for the 1.119 release window: VS Code `1.118.1`, commit `034f571df509819cc10b0c8129f66ef77a542f0e`.

Official release-note anchors:

- VS Code 1.120 release notes: <https://code.visualstudio.com/updates/v1_120>
- VS Code 1.119 release notes: <https://code.visualstudio.com/updates/v1_119>

The local VS Code source repo at `/Users/yinghaozhao/code/github/vscode` is on `main` and was behind `origin/main` during inspection, so the report uses release tags for API diffs:

```bash
git -C /Users/yinghaozhao/code/github/vscode diff --name-status 1.119.1 1.120.0 -- src/vscode-dts
git -C /Users/yinghaozhao/code/github/vscode diff --name-status 1.118.1 1.119.1 -- src/vscode-dts
```

## Executive Summary

The stable public API surface barely changed in the two release windows:

- `1.118.1 -> 1.119.1`: no changes to `src/vscode-dts/vscode.d.ts`.
- `1.119.1 -> 1.120.0`: one documentation-only public API note on `TreeDataProvider.getChildren(...)`; no public language-model or chat API shape changed.

The proposed API surface changed more substantially:

- `1.119` moved model cost display away from the old proposed `multiplier` string and toward `languageModelPricing` fields (`pricing`, `inputCost`, `outputCost`, `cacheCost`).
- `1.120` added `priceCategory` to `languageModelPricing`, plus new diff/custom-editor proposals and `workingDirectory` metadata for private tool invocation.
- `languageModelThinkingPart` did not change across `1.118.1`, `1.119.1`, and `1.120.0`; it remains proposed and version `1`.

For `zenmux-copilot` / InfiniAI Copilot:

- The `reasoning_content` HTTP 400 issue is not fixed by VS Code 1.119 or 1.120 API changes. The thinking API is still proposed and unchanged.
- Stable VS Code 1.120 still cannot provide `LanguageModelThinkingPart` as a public stable API. The latest `zenmux-copilot` working tree now keeps the request-body force-disable guard on stable by default.
- Insiders/proposed API support can carry `LanguageModelThinkingPart` through the language-model transport, but chat participant history still does not expose thinking parts as regular `ChatResponseTurn` history. The latest `zenmux-copilot` working tree therefore no longer treats constructor availability as an automatic end-to-end replay guarantee.
- The extension currently declares only `enabledApiProposals: ["languageModelThinkingPart"]`; it does not declare `chatProvider` or `languageModelPricing`.
- The extension now contributes `infiniai.enableThinkingRoundTripForModels` as an advanced opt-in setting, but the setting is intentionally inert for affected models unless a verified replay backend is added.
- The extension currently sets `isUserSelectable: true` by casting to `LanguageModelChatInformation`. Keep this as a best-effort host hint, but do not rely on it as the only visibility control.
- The `1.119` and `1.120` pricing proposals are optional opportunities for better model picker cost display, not required fixes. Only consider them if InfiniAI has reliable model cost metadata.

## API-Change Decision Guardrails

Use these rules when translating this report into `zenmux-copilot` work:

1. Keep `isUserSelectable: true` as a best-effort model-picker hint, but do not rely on it. Provider-owned visibility controls remain the durable UX.
2. Consider `languageModelPricing` only if InfiniAI discovery or another trusted source provides reliable per-model/per-plan cost metadata. A wrong pricing badge is worse than no badge.
3. Do not raise `engines.vscode` unless the extension deliberately adds a real newer stable public API dependency.
4. Do not chase `chatParticipantPrivate`, `chatParticipantAdditions`, or `toolInvocationApproveCombination` for current source. The current extension does not use those APIs.
5. Align `@types/vscode` carefully. Newer type packages can expose newer stable APIs and make accidental compatibility regressions easier; prefer a deliberate type bump with review, or vendored proposed d.ts files only for explicitly enabled proposals.
6. Treat the current thinking-mode implementation as the correct release posture: force-disable affected models by default on stable and Insiders; only relax it after a concrete replay backend is implemented and tested.

## Version Evidence

Installed binaries:

```text
code --version
1.120.0
0958016b2af9f09bb4257e0df4a95e2f90590f9f
arm64

code-insiders --version
1.121.0-insider
0b181f582148d69d10d997a41353d52b563e3733
arm64
```

Local release tags:

```text
1.120.0 0958016b2af9f09bb4257e0df4a95e2f90590f9f 2026-05-12
1.119.1 3fe68d450d4918f375c155b26a3a8e08f25b4e92 2026-05-12
1.118.1 034f571df509819cc10b0c8129f66ef77a542f0e 2026-04-29
```

Official release notes say VS Code `1.120` was released on May 13, 2026 and call out BYOK model visibility/control improvements, including token usage and thinking effort controls for BYOK reasoning models.

## Public API Changes

### 1.118.1 -> 1.119.1

No public API changes were found in:

```text
src/vscode-dts/vscode.d.ts
```

Command evidence:

```bash
git -C /Users/yinghaozhao/code/github/vscode diff --unified=20 1.118.1 1.119.1 -- src/vscode-dts/vscode.d.ts
```

Output: empty diff.

### 1.119.1 -> 1.120.0

Only one public API documentation note was added. The type signature did not change:

```diff
 export interface TreeDataProvider<T> {
   /**
    * Get the children of `element` or root if no element is passed.
    *
+   * *Note:* The result is not mutated by the API consumer; readonly arrays may be cast to `T[]`.
+   *
    * @param element The element from which the provider gets children. Can be `undefined`.
    * @returns Children of `element` or root if no element is passed.
    */
   getChildren(element?: T): ProviderResult<T[]>;
 }
```

Implication for `zenmux-copilot`: none. The extension does not implement `TreeDataProvider` in the relevant language-model/chat path, and this is a documentation clarification, not a new runtime contract.

## Proposed API Changes: 1.118.1 -> 1.119.1

Changed files:

```text
M src/vscode-dts/vscode.proposed.chatDebug.d.ts
A src/vscode-dts/vscode.proposed.chatInputNotification.d.ts
M src/vscode-dts/vscode.proposed.chatParticipantPrivate.d.ts
M src/vscode-dts/vscode.proposed.chatPromptFiles.d.ts
M src/vscode-dts/vscode.proposed.chatProvider.d.ts
M src/vscode-dts/vscode.proposed.chatSessionCustomizationProvider.d.ts
M src/vscode-dts/vscode.proposed.chatStatusItem.d.ts
A src/vscode-dts/vscode.proposed.languageModelPricing.d.ts
```

### `chatProvider` Version 4 -> 5

`extensionsApiProposals.ts` changed `chatProvider` from version `4` to version `5`.

API diff:

```diff
-// version: 4
+// version: 5

 export interface LanguageModelChatInformation {
-  /**
-   * A multiplier indicating how many requests this model counts towards a quota.
-   * For example, "2x" means each request counts twice.
-   */
-  readonly multiplier?: string;
-
   /**
-   * A numeric form of the `multiplier` label
+   * A numeric value for comparing model cost tiers.
    */
   readonly multiplierNumeric?: number;
 }
```

Runtime transport evidence in `src/vs/workbench/api/common/extHostLanguageModels.ts`:

```diff
- multiplier: m.multiplier,
  multiplierNumeric: m.multiplierNumeric,
+ pricing: m.pricing,
+ inputCost: m.inputCost,
+ outputCost: m.outputCost,
+ cacheCost: m.cacheCost,
```

Implication for `zenmux-copilot`:

- No break: the extension does not use `multiplier`.
- `isUserSelectable` existed before and remains in proposed `chatProvider`; the 1.119 change does not explain model visibility issues by itself.
- If the extension wants to show pricing/cost metadata in newer VS Code model UIs, it should adopt `languageModelPricing` deliberately instead of using the removed `multiplier` string.

### New `languageModelPricing`

1.119 added `src/vscode-dts/vscode.proposed.languageModelPricing.d.ts`:

```ts
export interface LanguageModelChatInformation {
	readonly pricing?: string;
	readonly inputCost?: number;
	readonly outputCost?: number;
	readonly cacheCost?: number;
}

export interface LanguageModelChat {
	readonly pricing?: string;
	readonly inputCost?: number;
	readonly outputCost?: number;
	readonly cacheCost?: number;
}
```

Implication for `zenmux-copilot`:

- Optional enhancement only.
- The InfiniAI model discovery API would need reliable per-model cost metadata before this should be surfaced.
- Since `languageModelPricing` is proposed, using it as typed API requires a vendored proposed d.ts and `enabledApiProposals` entry. Returning these fields as runtime metadata may work on hosts that read them, but it is not a stable public API contract.

### `chatDebug` Request Metadata

1.119 added debug event fields:

```ts
requestId?: string;
requestOptions?: string;
```

Implication for `zenmux-copilot`:

- No direct runtime requirement.
- Useful design reference for future diagnostics: `requestOptions` explicitly calls out cache-relevant model request options such as `tool_choice`, `reasoning_effort`, `thinking`, and `response_format`.
- For the `reasoning_content` 400 work, the extension should log equivalent sanitized request-shape diagnostics without logging actual reasoning text.

### `chatParticipantPrivate`

1.119 added:

```ts
isExpectedError?: boolean;
traceparent?: string;
tracestate?: string;
```

Implication for `zenmux-copilot`:

- No direct effect because the extension is a language-model provider, not a private chat participant/tool provider.
- If the extension later exposes tools or deeper chat participant integration, trace context and expected-error semantics are useful for reducing noisy telemetry and correlating tool calls.

### New `chatInputNotification`

1.119 added a proposed chat input notification surface:

```ts
namespace chat {
	export function createInputNotification(id: string): ChatInputNotification;
}
```

Implication for `zenmux-copilot`:

- No direct requirement.
- Potential future UI option for quota/API-key warnings, but not necessary for the model provider path.

## Proposed API Changes: 1.119.1 -> 1.120.0

Changed files:

```text
M src/vscode-dts/vscode.d.ts
A src/vscode-dts/vscode.proposed.agentsWindowConfiguration.d.ts
M src/vscode-dts/vscode.proposed.chatDebug.d.ts
M src/vscode-dts/vscode.proposed.chatParticipantPrivate.d.ts
M src/vscode-dts/vscode.proposed.chatPromptFiles.d.ts
A src/vscode-dts/vscode.proposed.customEditorDiffs.d.ts
A src/vscode-dts/vscode.proposed.customEditorPriority.d.ts
A src/vscode-dts/vscode.proposed.documentDiff.d.ts
M src/vscode-dts/vscode.proposed.languageModelPricing.d.ts
```

### `languageModelPricing.priceCategory`

1.120 added:

```ts
export interface LanguageModelChatInformation {
	readonly priceCategory?: string;
}

export interface LanguageModelChat {
	readonly priceCategory?: string;
}
```

Runtime transport evidence in `src/vs/workbench/api/common/extHostLanguageModels.ts`:

```diff
 pricing: m.pricing,
 inputCost: m.inputCost,
 outputCost: m.outputCost,
 cacheCost: m.cacheCost,
+priceCategory: m.priceCategory,
```

Implication for `zenmux-copilot`:

- Optional enhancement for model picker visual cost hints.
- Not required to fix `reasoning_content`.
- Do not add this until InfiniAI has a stable mapping from models/plans to cost categories. A wrong cost badge is worse than no badge.

### `chatParticipantPrivate.workingDirectory`

1.120 added `workingDirectory?: Uri` to tool invocation options:

```ts
export interface LanguageModelToolInvocationOptions<T> {
	workingDirectory?: Uri;
}

export interface LanguageModelToolInvocationPrepareOptions<T> {
	workingDirectory?: Uri;
}
```

Runtime conversion evidence in `src/vs/workbench/api/common/extHostTypeConverters.ts`:

```diff
-toolInvocationToken: Object.freeze<IToolInvocationContext>({ sessionResource: request.sessionResource }) as never,
+toolInvocationToken: Object.freeze<IToolInvocationContext>({ sessionResource: request.sessionResource, workingDirectory: URI.revive(request.workingDirectory) }) as never,
```

Implication for `zenmux-copilot`:

- No direct effect on the provider path.
- If the extension later contributes tools, this becomes important for Agents-window sessions where the working directory can differ from the workspace folders.

### `chatDebug.copilotUsageNanoAiu`

1.120 added:

```ts
copilotUsageNanoAiu?: number;
```

Implication for `zenmux-copilot`:

- No direct effect.
- This is Copilot-usage telemetry oriented, not InfiniAI billing metadata.

### New Diff and Custom Editor Proposals

1.120 added:

- `agentsWindowConfiguration`
- `customEditorDiffs`
- `customEditorPriority`
- `documentDiff`

Official 1.120 release notes describe custom editor diffs and `workspace.getTextDiff(...)` as proposed APIs for diff-related extensions.

Implication for `zenmux-copilot`:

- No direct effect. The extension does not implement custom editors or document diff UI.

## `languageModelThinkingPart` Status Across Both Releases

This is the API most relevant to the InfiniAI `reasoning_content` failure.

Evidence:

```text
git ls-tree 1.118.1 src/vscode-dts/vscode.proposed.languageModelThinkingPart.d.ts
git ls-tree 1.119.1 src/vscode-dts/vscode.proposed.languageModelThinkingPart.d.ts
git ls-tree 1.120.0 src/vscode-dts/vscode.proposed.languageModelThinkingPart.d.ts
```

All three tags point to the same blob:

```text
7c5da1aa622b439dfae5eabcee8b957697161b92
```

Diff evidence:

```bash
git -C /Users/yinghaozhao/code/github/vscode diff --quiet 1.118.1 1.120.0 -- src/vscode-dts/vscode.proposed.languageModelThinkingPart.d.ts
```

Exit code: `0`, meaning no changes.

The proposed file still declares:

```ts
export class LanguageModelThinkingPart {
	value: string | string[];
	id?: string;
	metadata?: { readonly [key: string]: any };
	constructor(value: string | string[], id?: string, metadata?: { readonly [key: string]: any });
}

export interface LanguageModelChatResponse {
	stream: AsyncIterable<LanguageModelTextPart | LanguageModelThinkingPart | LanguageModelToolCallPart | unknown>;
}

export class LanguageModelChatMessage2 {
	content: Array<
		LanguageModelTextPart |
		LanguageModelToolResultPart |
		LanguageModelToolCallPart |
		LanguageModelDataPart |
		LanguageModelThinkingPart
	>;
}
```

Implication:

- The thinking part API did not mature into stable public API in 1.119 or 1.120.
- The API did not gain new semantics that would solve replay for Copilot Chat participant history.
- The 0.5.3 assumption that constructor availability implies end-to-end `reasoning_content` replay remains unsafe.

## Stable Public Chat History Still Excludes Thinking

The stable `vscode.d.ts` chat participant history type in 1.120 still exposes only content-like response parts:

```ts
export class ChatResponseTurn {
	readonly response: ReadonlyArray<
		ChatResponseMarkdownPart |
		ChatResponseFileTreePart |
		ChatResponseAnchorPart |
		ChatResponseCommandButtonPart
	>;
}
```

1.120 source evidence:

- `src/vscode-dts/vscode.d.ts`: `ChatResponseTurn.response` excludes thinking parts.
- `src/vs/workbench/api/common/extHostChatAgents2.ts`: response history is reconstructed with `typeConvert.ChatResponsePart.toContent(...)`.
- `src/vs/workbench/api/common/extHostTypeConverters.ts`: `toContent(...)` converts markdown, inline references, progress, file trees, and commands; it has no thinking case.

At the same time, the proposed language-model transport can carry thinking:

```ts
if (fragment instanceof extHostTypes.LanguageModelThinkingPart) {
	part = { type: 'thinking', value: fragment.value, id: fragment.id, metadata: fragment.metadata };
}
```

Implication:

- VS Code has a transport path that can carry thinking when proposed APIs are available.
- VS Code stable chat participant history still does not provide an end-to-end replay guarantee for InfiniAI `reasoning_content`.
- This supports the previous 400 root-cause report: host thinking-part transport is not the same thing as safe replay through Copilot Chat history.

## Zenmux Copilot Source Impact

Current extension facts in the latest working tree:

```jsonc
"engines": {
	"vscode": "^1.117.0"
},
"contributes": {
	"configuration": {
		"properties": {
			"infiniai.enableThinkingRoundTripForModels": {
				"type": "array",
				"default": []
			}
		}
	}
},
"enabledApiProposals": [
	"languageModelThinkingPart"
],
"devDependencies": {
	"@types/vscode": "^1.116.0"
}
```

Current source search evidence:

```bash
rg -n "languageModelPricing|priceCategory|pricing|inputCost|outputCost|cacheCost|multiplier|chatParticipantPrivate|chatParticipantAdditions|toolInvocationApproveCombination|approveCombination|ChatResponseInfoPart|traceparent|tracestate|workingDirectory|isExpectedError|isUserSelectable" src package.json --glob '!out/**'
```

Current output:

```text
src/provider.ts:466:			isUserSelectable: true,
```

Interpretation: the current source still does not consume `languageModelPricing`, `chatParticipantPrivate`, `chatParticipantAdditions`, `toolInvocationApproveCombination`, or the post-1.120 local-main churn fields. The only hit from that search is the intentional `isUserSelectable` host hint.

Current provider metadata:

```ts
return {
	id: model.id,
	name: model.id,
	tooltip: `InfiniAI Model ${model.id}`,
	detail: `InfiniAI ${route.transport}`,
	family: model.family ?? route.endpointKind,
	version: model.created?.toString() || "1.0.0",
	maxInputTokens: maxInput,
	maxOutputTokens: maxOutput,
	isUserSelectable: true,
	capabilities: {
		toolCalling: !model.id.includes("embed") && !model.id.includes("reranker"),
		imageInput: resolveImageInputCapability(model, { enablePatterns, disablePatterns }),
	},
} as LanguageModelChatInformation;
```

Current proposed thinking handling:

```ts
const ThinkingPartCtor = getThinkingPartCtor();
// ...
if (thinkingTexts.length > 0) {
	assistantMessage.reasoning_content = thinkingTexts.join("");
}
```

Current thinking fallback:

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

Current thinking-pattern helpers:

```ts
export function getEffectiveDisableThinkingPatterns(): string[] {
	const cfg = getInfiniAIConfiguration();
	const user = asPatternList(cfg.get<unknown>("disableThinkingForModels", []));
	return uniquePatterns([...DEFAULT_DISABLE_THINKING_PATTERNS, ...user]);
}

export function getThinkingRoundTripPatterns(): string[] {
	const cfg = getInfiniAIConfiguration();
	const user = asPatternList(cfg.get<unknown>("enableThinkingRoundTripForModels", []));
	return uniquePatterns([...DEFAULT_ENABLE_THINKING_ROUND_TRIP_PATTERNS, ...user]);
}

export function isKnownThinkingRoundTripSafeRequest(): boolean {
	return false;
}
```

Current sanitized thinking diagnostics:

```ts
logDebug(
	this.output,
	`Thinking guard model=${sanitizeForLog(model.id, 120)} vscode=${sanitizeForLog(vscode.version, 40)} ` +
		`app=${sanitizeForLog(vscode.env.appName, 80)} transport=OpenAI ` +
		`requestInitiator=${sanitizeForLog(String(requestInitiator ?? ""), 120)} ` +
		`hasThinkingPartApi=${hasThinkingPartApi()} ` +
		`forceDisable=${shouldDisableThinking(model.id, disableThinkingPatterns)} ` +
		`roundTripOptIn=${shouldEnableThinkingRoundTrip(model.id, roundTripPatterns)} ` +
		`thinkingDisabled=${requestBody.enable_thinking === false} ` +
		`disablePatterns=${sanitizeForLog(disableThinkingPatterns.join(","), 300)} ` +
		`roundTripPatterns=${sanitizeForLog(roundTripPatterns.join(","), 300)} ` +
		`assistantToolCalls=${thinkingSummary.assistantToolCallCount} ` +
		`assistantReasoning=${thinkingSummary.assistantReasoningCount} ` +
		`assistantToolCallsMissingReasoning=${thinkingSummary.assistantToolCallMissingReasoningCount}`
);
```

Latest implementation status:

- Done: the force-disable list now wins on stable and Insiders unless `allowThinkingRoundTrip` becomes true.
- Done: user `disableThinkingForModels` entries are additive with built-in safety defaults instead of replacing them.
- Done: `enableThinkingRoundTripForModels` is accepted on stable and Insiders but does not enable thinking without a verified replay backend.
- Done: request diagnostics now expose the thinking-guard decision and assistant message counts without logging `reasoning_content` itself.
- Not done by design: no extension-owned `reasoning_content` store exists yet, so affected models remain force-disabled by default.

### Impact 1: Minimum VS Code Engine Is Still Valid

No public API change in 1.119 or 1.120 requires raising the extension's minimum engine beyond `^1.117.0`.

The extension should only raise the engine if it intentionally depends on a newer stable public API. The relevant chat/model changes in 1.119/1.120 are proposed or documentation-only. Do not raise the engine for `languageModelPricing`, `isUserSelectable`, or `LanguageModelThinkingPart` alone because those are proposed surfaces, not stable public API dependencies.

### Impact 2: `@types/vscode` Is Older Than the Target Hosts

The extension compiles against `@types/vscode@1.116.0` while targeting `^1.117.0` and running on 1.119/1.120 hosts.

This is workable because the extension only uses stable language-model provider types plus vendored proposed thinking d.ts. However:

- If the extension adopts `languageModelPricing`, it needs either updated types or a vendored proposed d.ts.
- If the extension wants typed access to newer stable public comments/documentation, update `@types/vscode` to match the minimum or target host.
- Do not update types casually if the goal is keeping older VS Code compatibility; type availability can tempt accidental use of newer APIs.
- If `@types/vscode` is bumped, treat it as a compatibility-sensitive change: inspect the diff, keep `engines.vscode` unchanged unless a real stable API dependency is introduced, and avoid replacing vendored proposed APIs with ambient typings unless the corresponding proposal is intentionally enabled.

### Impact 3: Model Visibility Depends on Proposed `chatProvider` Metadata

`isUserSelectable` is not in stable `vscode.d.ts` `LanguageModelChatInformation`; it is in `vscode.proposed.chatProvider.d.ts`.

The extension currently sets it by cast. This can work as host-consumed metadata, but it is not a stable public API contract. The 1.119/1.120 API diffs did not remove `isUserSelectable`; therefore:

- The model visibility behavior is not caused by a last-two-release removal of that field.
- If visibility is critical, keep the extension-owned hide/show controls as the durable UX.
- Treat `isUserSelectable` as a best-effort host hint.
- Do not remove `isUserSelectable: true`; it is still useful on hosts that honor the proposed metadata.
- Do not rely on `isUserSelectable: true`; stable-host behavior and future proposed-API churn can still differ.

### Impact 4: Pricing Metadata Is a Future Enhancement

From 1.119 onward, VS Code has proposed pricing metadata fields; 1.120 adds `priceCategory`.

Possible future model info addition:

```ts
return {
	// existing fields...
	pricing: model.pricingLabel,
	inputCost: model.inputCostPerMillionTokens,
	outputCost: model.outputCostPerMillionTokens,
	cacheCost: model.cacheCostPerMillionTokens,
	priceCategory: model.priceCategory,
} as LanguageModelChatInformation;
```

Recommended conditions before implementing:

- InfiniAI model discovery returns reliable per-plan/per-model cost metadata.
- The extension adds tests that unknown/missing cost fields are omitted.
- The extension documents that pricing display is best-effort on hosts that understand the proposed metadata.
- The extension intentionally opts into the proposal if it wants typed access, or returns only runtime metadata after testing the host behavior.

Do not use `multiplier`; it was removed from proposed `chatProvider` in 1.119.

Do not invent a static cost table in the extension unless InfiniAI owns and maintains that table. Pricing is user-visible billing information; stale or guessed costs would be a product bug, not a cosmetic issue.

### Impact 5: `reasoning_content` Fix Must Stay Extension-Side

Because `languageModelThinkingPart` is unchanged and still proposed:

- Stable VS Code path: the latest working tree force-disables thinking for affected models by default.
- Insiders path: the latest working tree does not treat `getThinkingPartCtor()` as proof of end-to-end replay.
- Cross-host opt-in `infiniai.enableThinkingRoundTripForModels` now exists, but remains effective only when backed by either verified host replay or an extension-owned `reasoning_content` store.

Implemented request-body condition:

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

`getDisableThinkingPatterns()` is now a backward-compatible wrapper over the effective additive default+user list. `isKnownThinkingRoundTripSafeRequest()` currently returns `false`, so the explicit round-trip opt-in is accepted but does not bypass the safety guard yet.

## Note on Post-1.120 Local `main` Proposed API Churn

A separate review claimed that several proposed APIs had changes such as `chatProvider.multiplier`, `chatParticipantPrivate` removals, `chatParticipantAdditions` removals, and `toolInvocationApproveCombination` type changes. Those claims are not true for the stable release comparison in this report (`1.119.1 -> 1.120.0`). They are partly true if comparing the `1.120.0` release tag to the current local VS Code `main` checkout:

```bash
git -C /Users/yinghaozhao/code/github/vscode diff --name-status 1.120.0 HEAD -- \
  src/vscode-dts/vscode.proposed.chatProvider.d.ts \
  src/vscode-dts/vscode.proposed.chatParticipantPrivate.d.ts \
  src/vscode-dts/vscode.proposed.chatParticipantAdditions.d.ts \
  src/vscode-dts/vscode.proposed.toolInvocationApproveCombination.d.ts
```

Local `main` evidence:

```text
M src/vscode-dts/vscode.proposed.chatParticipantAdditions.d.ts
M src/vscode-dts/vscode.proposed.chatParticipantPrivate.d.ts
M src/vscode-dts/vscode.proposed.chatProvider.d.ts
M src/vscode-dts/vscode.proposed.toolInvocationApproveCombination.d.ts
```

True only for `1.120.0 -> local main`:

- `chatProvider`: local `main` reintroduces `LanguageModelChatInformation.multiplier?: string` and changes the proposal header from version `5` back to version `4`. This is the inverse of the `1.118.1 -> 1.119.1` stable-window change, where `multiplier` was removed.
- `chatParticipantPrivate`: local `main` removes `isExpectedError`, `workingDirectory`, `traceparent`, and `tracestate`. In the stable windows covered above, these fields were added, not removed.
- `chatParticipantAdditions`: local `main` removes `ChatResponseInfoPart` and `ChatResponseStream.info(...)`. In `1.118.1`, `1.119.1`, and `1.120.0`, they are present and unchanged.
- `toolInvocationApproveCombination`: local `main` changes `approveCombination` from an object shape to `string | MarkdownString`. In `1.118.1`, `1.119.1`, and `1.120.0`, the object shape is unchanged.

Impact on `zenmux-copilot`: none for current source. A direct source search found no usage of `chatParticipantPrivate`, `chatParticipantAdditions`, `toolInvocationApproveCombination`, `multiplier`, `ChatResponseInfoPart`, `approveCombination`, `traceparent`, `tracestate`, `workingDirectory`, or `isExpectedError` in `src/` or `package.json`. The extension currently enables only `languageModelThinkingPart`:

```jsonc
"enabledApiProposals": [
	"languageModelThinkingPart"
]
```

So the post-1.120 local-main churn is useful future-watch context, but it does not change the report's stable-release conclusion and does not require a `zenmux-copilot` code change today. Do not create tasks for `chatParticipantPrivate`, `chatParticipantAdditions`, or `toolInvocationApproveCombination` unless a future source search shows real usage in `package.json`, `src/`, vendored d.ts files, or runtime tests.

### Why the False Claim Was Plausible

The false claim likely came from mixing several true observations with the wrong scope:

1. The reviewer likely compared `1.120.0` against the local VS Code `main` checkout, then described those changes as if they were part of the stable `1.119.1 -> 1.120.0` release window.
2. The diff direction was probably inverted. In `1.118.1 -> 1.119.1`, `chatProvider.multiplier` was removed. In `1.120.0 -> local main`, it appears again. Calling it "new" without naming the exact base and target makes both statements look possible.
3. Proposed APIs were treated like stable release APIs. These files churn quickly and can move backward, disappear, or be rewritten before a stable release.
4. "Nearby API" was mistaken for "extension dependency". `zenmux-copilot` is a language-model provider, but that does not mean it uses every chat-related proposed API. The manifest and source say it enables only `languageModelThinkingPart`.
5. Documentation/report hits can create false confidence. Searching the whole repo may find API names in README, changelog, or reports, but actual dependency checks must focus on `package.json`, `src/`, vendored proposed d.ts files, and compiled runtime behavior.
6. The local VS Code `main` checkout was behind `origin/main`, so even "current main" findings are local-snapshot findings, not guaranteed latest upstream truth.

### Prevention Reminders

Before accepting or publishing future VS Code API-impact claims:

1. Pin the exact comparison:

```bash
git -C /Users/yinghaozhao/code/github/vscode show -s --format='%H %cs %D' <base>
git -C /Users/yinghaozhao/code/github/vscode show -s --format='%H %cs %D' <target>
git -C /Users/yinghaozhao/code/github/vscode diff --name-status <base> <target> -- src/vscode-dts
```

2. State the direction in prose:

```text
This statement is for <base> -> <target>, not for local main or another release train.
```

3. Verify whether a field was added or removed from the actual hunk, not from memory:

```bash
git -C /Users/yinghaozhao/code/github/vscode diff --unified=25 <base> <target> -- <proposal-file>
```

4. Separate stable public API from proposed API:

```text
src/vscode-dts/vscode.d.ts = stable public API
src/vscode-dts/vscode.proposed.*.d.ts = proposed API, unstable by design
```

5. Prove extension dependency from the extension, not from API proximity:

```bash
rg -n "enabledApiProposals|<apiName>|<symbolName>" package.json src --glob '!out/**'
```

6. Treat local VS Code `main` as a snapshot. If the claim says "latest upstream", fetch or explicitly label the result as local and possibly stale. For this report, stable release tags are the source of truth.

7. When a claim says "may require code changes", require both conditions:

```text
The API changed in the stated comparison.
The extension actually consumes that API in manifest/source/runtime.
```

If either condition is false, record it as future-watch context, not an action item.

## Recommended Actions for Zenmux Copilot

1. Keep `engines.vscode` at `^1.117.0` unless a deliberate new stable public API dependency is introduced. Do not raise it for proposed-only fields or documentation-only public API changes.

2. Keep the implemented thinking fallback independent of VS Code 1.119/1.120:

```ts
if (shouldDisableThinking(modelId, getDisableThinkingPatterns()) && !allowThinkingRoundTrip) {
	applyDisableThinking(orb);
}
```

3. Do not make `LanguageModelThinkingPart` constructor detection the only safety gate. This has been fixed in the latest working tree and should remain protected by regression tests.

4. Keep `isUserSelectable: true` as a best-effort model picker hint, but do not rely on it as the only visibility control.

5. Consider `languageModelPricing` only as an optional enhancement:

- Add vendored proposed d.ts only if the extension intentionally opts into that proposal.
- Do not surface pricing unless InfiniAI API returns accurate model costs.
- Prefer `pricing`, `inputCost`, `outputCost`, `cacheCost`, and `priceCategory`; do not use old `multiplier`.
- Do not invent or guess model costs in extension code.

6. Keep the new sanitized thinking-guard diagnostics and extend them only with non-sensitive metadata:

- request id
- model id
- request option shape
- whether thinking was disabled
- whether assistant tool-call history lacked `reasoning_content`

The latest working tree already logs model id, VS Code version/app name, request initiator, thinking-part availability, force-disable/opt-in decisions, disable/round-trip pattern lists, and assistant history counts. It still does not log `reasoning_content`.

7. Do not chase `chatParticipantPrivate`, `chatParticipantAdditions`, or `toolInvocationApproveCombination` now. Current `zenmux-copilot` source does not use them.

8. For future Agents-window/tool support, account for 1.120 `workingDirectory`; model-provider-only code does not need it now.

9. Consider aligning `@types/vscode` only deliberately:

- Inspect the type diff before bumping.
- Keep `engines.vscode` unchanged unless the implementation adds a real newer stable API dependency.
- Prefer vendored proposed d.ts files for intentionally enabled proposals, so proposed APIs do not silently leak into normal stable-code paths.

## Verification Commands Used

```bash
code --version
/Applications/Visual\ Studio\ Code\ -\ Insiders.app/Contents/Resources/app/bin/code --version
git -C /Users/yinghaozhao/code/github/vscode status --short --branch
git -C /Users/yinghaozhao/code/github/vscode tag -l '1.12*'
git -C /Users/yinghaozhao/code/github/vscode tag -l '1.11*'
git -C /Users/yinghaozhao/code/github/vscode diff --name-status 1.119.1 1.120.0 -- src/vscode-dts
git -C /Users/yinghaozhao/code/github/vscode diff --name-status 1.118.1 1.119.1 -- src/vscode-dts
git -C /Users/yinghaozhao/code/github/vscode diff --unified=20 1.119.1 1.120.0 -- src/vscode-dts/vscode.d.ts
git -C /Users/yinghaozhao/code/github/vscode diff --unified=20 1.118.1 1.119.1 -- src/vscode-dts/vscode.d.ts
git -C /Users/yinghaozhao/code/github/vscode diff --quiet 1.118.1 1.120.0 -- src/vscode-dts/vscode.proposed.languageModelThinkingPart.d.ts
rg -n "enabledApiProposals|languageModelThinkingPart|isUserSelectable|pricing|priceCategory|disableThinkingForModels" package.json src README.md CHANGELOG.md
rg -n "languageModelPricing|priceCategory|pricing|inputCost|outputCost|cacheCost|multiplier|chatParticipantPrivate|chatParticipantAdditions|toolInvocationApproveCombination|approveCombination|ChatResponseInfoPart|traceparent|tracestate|workingDirectory|isExpectedError|isUserSelectable" src package.json --glob '!out/**'
rg -n "enableThinkingRoundTripForModels|isKnownThinkingRoundTripSafeRequest|Thinking guard|assistantToolCallsMissingReasoning|getEffectiveDisableThinkingPatterns" package.json src README.md README.zh.md CHANGELOG.md --glob '!out/**'
npm run lint
npm test
```

## Bottom Line

VS Code 1.119 and 1.120 did not introduce a stable public API that solves InfiniAI's `reasoning_content` replay problem. The relevant thinking API remains proposed and unchanged. The extension should keep the fix in its own request-shaping logic: force-disable thinking for affected models by default, and only allow thinking when a verified replay backend exists.

The latest `zenmux-copilot` working tree now implements that request-shaping fix and the safe opt-in shape. The main remaining API-change opportunity from these releases is optional pricing metadata for the model picker. It is useful, but separate from the 400 issue and should wait for reliable InfiniAI pricing metadata.
