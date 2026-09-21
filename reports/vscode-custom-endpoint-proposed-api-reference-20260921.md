# Referencing VS Code's Built-in "Custom Endpoint" Feature: Proposed-API Coupling and Safe-Reuse Design Report

Date: 2026-09-21

## Scope

This report analyzes how VS Code's built-in **Custom Endpoint** BYOK feature is implemented, precisely which parts of it sit on **stable** VS Code APIs versus **proposed** APIs, and how `zenmux-copilot` (InfiniAI Copilot) can safely reference its design without contaminating our extension with proposed-API dependencies.

Sources of truth used for this report:

- VS Code stable source: `/Users/yinghaozhao/code/github/vscode` at tag `1.138.0`, commit `7debcd0e2acdea1c52de81bf9ee1620444407dda`.
- Built-in Copilot Chat extension (vendored into the vscode repo): `extensions/copilot/`.
- Our extension: `/Users/yinghaozhao/code/github/zenmux-copilot` on branch `infini-ai-copilot`.

Key files inspected:

- `extensions/copilot/src/extension/byok/vscode-node/byokContribution.ts` — provider registration.
- `extensions/copilot/src/extension/byok/vscode-node/abstractLanguageModelChatProvider.ts` — provider base classes.
- `extensions/copilot/src/extension/byok/vscode-node/customEndpointProvider.ts` — the Custom Endpoint provider.
- `extensions/copilot/package.json` — `enabledApiProposals` and `contributes.languageModelChatProviders`.
- `src/vscode-dts/vscode.d.ts` and `src/vscode-dts/vscode.proposed.*.d.ts` — the stable/proposed split.
- Our `src/provider.ts`, `src/providerConfiguration.ts`, `src/stableApiGuardrails.test.ts`.

## Executive Summary

- **Custom Endpoint is not core workbench code.** It ships inside the built-in Copilot Chat extension at `extensions/copilot/src/extension/byok/vscode-node/customEndpointProvider.ts` (`CustomEndpointBYOKModelProvider`, vendor id `customendpoint`). It is "built-in" only in the sense that it is bundled with VS Code; mechanically it is an extension using the public Language Model provider extension point.
- **Its skeleton is the same stable BYOK API we use**: the `contributes.languageModelChatProviders` contribution point, `lm.registerLanguageModelChatProvider(...)`, and the `LanguageModelChatProvider` interface.
- **But it is genuinely coupled to proposed APIs** in several data-carrying spots, because the Copilot extension opts into proposals (`chatProvider`, `languageModelThinkingPart`, `languageModelCapabilities`, `languageModelPricing`, `languageModelSystem`). Specifically: the `configuration` field on the prepare options, `isBYOK`, `LanguageModelChatMessage2`, `LanguageModelResponsePart2`, and `configurationSchema` are proposed-only at 1.138.0.
- **`zenmux-copilot` enables zero API proposals** and already isolates the one runtime-proposed field it needs (`configuration`) through a defensively-typed local shim (`src/providerConfiguration.ts`) plus a guardrail test (`src/stableApiGuardrails.test.ts`).
- **Conclusion:** It is safe to reference Custom Endpoint's *architecture and workflow patterns*, but not its *type signatures*. Copying Copilot's method signatures verbatim would pull in proposed types. The correct approach — which we already follow — is to keep stable type imports, read proposed runtime fields through `unknown`-typed shims with runtime guards, and keep the guardrail test enforcing this boundary.

## 1. What the Custom Endpoint feature is and where it lives

The Custom Endpoint provider is registered by the Copilot BYOK contribution:

```ts
// extensions/copilot/src/extension/byok/vscode-node/byokContribution.ts
this._providerRegistrations.add(lm.registerLanguageModelChatProvider(providerId, provider));
```

The provider class:

```ts
// extensions/copilot/src/extension/byok/vscode-node/customEndpointProvider.ts
export class CustomEndpointBYOKModelProvider extends AbstractOpenAICompatibleLMProvider<CustomEndpointModelProviderConfig> {
    public static readonly providerName = 'CustomEndpoint';
    public static readonly providerId = this.providerName.toLowerCase(); // 'customendpoint'
    // ...
}
```

The base class hierarchy is `AbstractLanguageModelChatProvider` (implements `LanguageModelChatProvider`) → `AbstractOpenAICompatibleLMProvider` → `CustomEndpointBYOKModelProvider`. The vendor id `customendpoint` is also hardcoded into the core telemetry allow-list at `src/vs/workbench/contrib/chat/common/languageModels.ts`, whose comment explicitly states these providers "ship in-built with the GitHub Copilot Chat extension … see `extensions/copilot/src/extension/byok/vscode-node/*Provider.ts`".

This is architecturally the **same mechanism** our `InfiniAIChatModelProvider` uses.

## 2. The stable/proposed split at 1.138.0 (measured)

The proposed `.d.ts` files augment the *same-named* stable interfaces via TypeScript declaration merging, so a single interface (e.g. `LanguageModelChatProvider`, `PrepareLanguageModelChatModelOptions`) can carry both stable and proposed members. Symbols were classified by checking presence in `src/vscode-dts/vscode.d.ts` versus `src/vscode-dts/vscode.proposed.*.d.ts`:

| Symbol | Stable `vscode.d.ts` | Proposed d.ts | Copilot Custom Endpoint uses it | zenmux-copilot uses it |
| --- | --- | --- | --- | --- |
| `lm.registerLanguageModelChatProvider` | Yes | — | Yes | Yes |
| `LanguageModelChatProvider` | Yes (base; augmented by proposed) | `chatProvider` | Yes | Yes |
| `provideTokenCount` | Yes | — | Yes | Yes |
| `LanguageModelChatRequestMessage` | Yes (augmented by proposed) | `chatProvider` | — | Yes |
| `PrepareLanguageModelChatModelOptions` | Yes — **only `silent`** | `chatProvider` (adds `configuration`) | Yes | Yes |
| `PrepareLanguageModelChatModelOptions.configuration` | **No** | **`chatProvider`** | Yes (destructures `{ silent, configuration }`) | Via `unknown` shim only |
| `LanguageModelChatInformation.isBYOK` | **No** | **`chatProvider`** | Yes (`isBYOK: true`) | No |
| `LanguageModelChatInformation.configurationSchema` | **No** | **`chatProvider`** | Yes | No (schema declared in `package.json` instead) |
| `LanguageModelChatMessage2` | **No** | **`languageModelThinkingPart`** | Yes (method signatures) | No (uses stable `LanguageModelChatRequestMessage`) |
| `LanguageModelResponsePart2` | **No** | **`chatProvider`** | Yes (`Progress<LanguageModelResponsePart2>`) | No |
| `LanguageModelChatInformation.capabilities.toolCalling` | Yes | — | Yes | Yes |
| `LanguageModelChatInformation.capabilities.imageInput` | Yes | — | Yes | Yes |

Reproduction command:

```bash
cd /Users/yinghaozhao/code/github/vscode
for sym in LanguageModelChatProvider registerLanguageModelChatProvider \
  PrepareLanguageModelChatModelOptions ProvideLanguageModelChatResponseOptions \
  LanguageModelChatRequestMessage LanguageModelChatMessage2 \
  LanguageModelResponsePart2 isBYOK provideTokenCount; do
  s=$(git grep -l "$sym" 1.138.0 -- src/vscode-dts/vscode.d.ts | wc -l | tr -d ' ')
  p=$(git grep -l "$sym" 1.138.0 -- 'src/vscode-dts/vscode.proposed.*.d.ts' | tr '\n' ',')
  printf "%-42s stable=%s proposed=[%s]\n" "$sym" "$s" "$p"
done
```

The stable `PrepareLanguageModelChatModelOptions` at 1.138.0 contains only `silent`; `configuration` is added by `vscode.proposed.chatProvider.d.ts`.

## 3. Where Custom Endpoint is coupled to proposed APIs

The Copilot code depends on proposed surface in these concrete spots (all enabled via `extensions/copilot/package.json` → `enabledApiProposals`, which includes `chatProvider`, `languageModelThinkingPart`, `languageModelCapabilities`, `languageModelPricing`, `languageModelSystem`):

1. **Reading per-provider configuration off the options object** — `abstractLanguageModelChatProvider.ts`:
   ```ts
   async provideLanguageModelChatInformation({ silent, configuration }: PrepareLanguageModelChatModelOptions, token) { /* ... */ }
   ```
   `configuration` is a proposed field.
2. **Marking models as BYOK** — same file returns `{ ...model, isBYOK: true, apiKey, configuration }`. `isBYOK` is proposed.
3. **Message and response-part types** — `provideLanguageModelChatResponse(... messages: Array<LanguageModelChatMessage | LanguageModelChatMessage2>, ..., progress: Progress<LanguageModelResponsePart2>, ...)` and `provideTokenCount(... text: string | LanguageModelChatMessage | LanguageModelChatMessage2, ...)`. `LanguageModelChatMessage2` and `LanguageModelResponsePart2` are proposed (thinking-part surface).
4. **Richer model metadata** — capabilities beyond `{ toolCalling, imageInput }`, pricing, and system-message handling flow through `languageModelCapabilities` / `languageModelPricing` / `languageModelSystem` proposals.

Net: the **provider skeleton is stable**, but the **data it exchanges with the core is partly typed against proposed interfaces.** Because proposals merge into the same interface names, this coupling is easy to introduce accidentally by copy-pasting signatures.

## 4. How zenmux-copilot already isolates the boundary (the pattern to keep)

Our extension declares **no** `enabledApiProposals` (verified: `package.json` has no such key) and reads the one proposed runtime field it needs through a local, `unknown`-typed shim with runtime guards:

```ts
// src/providerConfiguration.ts
import type { PrepareLanguageModelChatModelOptions } from "vscode"; // stable type only

type ProviderConfigurationOptions = PrepareLanguageModelChatModelOptions & {
    readonly configuration?: unknown; // locally re-declare the proposed field as unknown
};

export function readProviderApiKey(options: PrepareLanguageModelChatModelOptions): string | undefined {
    const configuration = (options as ProviderConfigurationOptions).configuration; // runtime read
    if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) {
        return undefined;
    }
    const apiKey = (configuration as Record<string, unknown>).apiKey;
    return typeof apiKey === "string" && apiKey.trim().length > 0 ? apiKey.trim() : undefined;
}
```

Why this works on stable, Marketplace-shipped VS Code:

- At **runtime**, VS Code populates the `configuration` object for every configurable vendor regardless of whether the extension enabled the `chatProvider` proposal. The proposal gates the *compile-time type* and some *function* availability, not the population of a data field passed into our callback.
- At **compile time**, we never import the proposed type, so we never take a build dependency on an unstable shape. The `unknown` + type-guard keeps us safe if the proposed shape changes.

The boundary is enforced by `src/stableApiGuardrails.test.ts`, which asserts our manifest and usage stay on stable API surface. Our `src/provider.ts` correspondingly uses the stable `LanguageModelChatRequestMessage` (not `LanguageModelChatMessage2`) and only reads `capabilities.toolCalling` / `capabilities.imageInput`.

## 5. Design guidance: what to reference vs what to avoid

### 5.1 Safe to reference (pure architecture/workflow, zero proposed coupling)

These are design patterns with no dependency on proposed types and can be adopted directly:

1. **Abstract base + thin subclasses.** `AbstractLanguageModelChatProvider` → `AbstractOpenAICompatibleLMProvider` → concrete provider. Each concrete class overrides only the differences (`getModelsBaseUrl`, `createOpenAIEndPoint`, `resolveModelCapabilities`). Applicable to consolidating our OpenAI/Anthropic/Vertex transports behind a shared base.
2. **Declarative model config with JSON Schema + `defaultSnippets`.** In `contributes.languageModelChatProviders[].configuration`, provide a schema with `defaultSnippets` (e.g. a "New Model" template), a `secret: true` `apiKey`, and enum fields with `enumItemLabels`/`enumDescriptions`. The contribution point itself is stable (we already declare it and it works).
3. **Precedence cascades.** Custom Endpoint resolves `apiType` as per-model → group-level → inferred-from-URL. This mirrors our capability/thinking resolution precedence in `src/modelCapabilities.ts` and `src/reasoningDialect.ts`; keep such chains explicit and ordered.
4. **Secret handling with `${apiKey}` substitution.** `apiKey` marked `secret: true`; custom headers may contain a `${apiKey}` placeholder that is substituted at request time so the secret never lands in plaintext settings.
5. **`silent` discovery contract.** When `silent` is true and no key is available, return empty rather than prompting. Ensure our `provideLanguageModelChatInformation` never triggers UI during silent resolution.
6. **Disposable + policy lifecycle.** Registrations held in a `DisposableStore`; providers registered only when allowed and cleanly unregistered (`.clear()`) when disallowed, re-evaluated on auth/policy change.
7. **Deprecation and migration hygiene.** Old `customoai` carries a `markdownDeprecationMessage` pointing at `customendpoint`; migrations use a dedicated command to move old storage into new config shape.
8. **Endpoint-quirk encapsulation.** Provider-specific HTTP differences (auth header style, Responses-API `store`, header override allow-list) are isolated in an endpoint subclass rather than leaking into the main provider.

### 5.2 Do NOT copy (proposed type coupling)

Copying these verbatim would take a build/runtime dependency on proposed surface:

- **Do not** destructure `options.configuration` against the imported `PrepareLanguageModelChatModelOptions`. Continue reading it through the `& { configuration?: unknown }` shim (`src/providerConfiguration.ts`).
- **Do not** set `isBYOK` on returned model information (proposed field).
- **Do not** return `configurationSchema` from `provideLanguageModelChatInformation`. Keep declaring the schema in `package.json` under `contributes.languageModelChatProviders[].configuration` (stable path).
- **Do not** change our method signatures to `LanguageModelChatMessage2` / `Progress<LanguageModelResponsePart2>`. Keep the stable `LanguageModelChatRequestMessage` and stable response parts.
- **Do not** consume proposed capability/pricing/system fields (`languageModelCapabilities`, `languageModelPricing`, `languageModelSystem`, `languageModelThinkingPart`). Restrict capability reads to the stable `capabilities.toolCalling` / `capabilities.imageInput`.

## 6. Concrete recommendations for zenmux-copilot

Mapped to our files, all achievable on stable API:

1. **Keep the proposed-field shim centralized.** `src/providerConfiguration.ts` is the single approved place that touches the proposed `configuration` runtime field. If future needs arise (e.g. reading additional per-model config), extend that shim with `unknown`-typed fields and guards; do not spread ad-hoc `as any` casts elsewhere.
2. **Extend the guardrail test.** `src/stableApiGuardrails.test.ts` should assert (a) `package.json` has no `enabledApiProposals`, and (b) no source file imports the proposed-only symbols (`LanguageModelChatMessage2`, `LanguageModelResponsePart2`, `isBYOK`, `configurationSchema`). This turns "do not copy" into an enforced invariant.
3. **Consider a base provider refactor** (optional, cosmetic): factor the shared OpenAI-compatible plumbing in `src/provider.ts` into a base class and keep transport-specific subclasses thin, following the Copilot layering — but preserve our stable message/response types.
4. **Adopt `defaultSnippets`** for any user-editable custom model configuration to improve editing UX, since the contribution point is stable.
5. **Keep capability resolution declarative** (already true): rely on provider-declared `toolCalling`/`imageInput` and our own `modelCapabilities.ts`/`reasoningDialect.ts` resolution; never infer capabilities from model names.

## 7. Risk register

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Accidentally importing a proposed type while mirroring Copilot signatures | Medium | Build breaks or requires proposal opt-in (cannot ship to Marketplace) | Guardrail test forbidding proposed-only imports; code review checklist |
| Proposed `configuration` runtime shape changes in a future VS Code | Low–Medium | Runtime read returns undefined; models silently unconfigured | `unknown` + type-guard shim already tolerant; add logging when `configuration` present but `apiKey` missing |
| `configuration` runtime field stops being populated for non-proposal extensions | Low | API key no longer delivered via options | Keep an alternate credential path (settings/secret storage) as fallback; monitor VS Code release notes for `chatProvider` stabilization |
| Copying pricing/thinking metadata handling | Low | Proposed coupling; Marketplace rejection | Explicitly excluded in section 5.2; guardrail test |

## 8. Verification appendix

```bash
# Confirm our extension enables no proposals
grep -n "enabledApiProposals" /Users/yinghaozhao/code/github/zenmux-copilot/package.json || echo "none (good)"

# Confirm Custom Endpoint registration + proposals in the built-in Copilot extension
cd /Users/yinghaozhao/code/github/vscode
grep -n "registerLanguageModelChatProvider" extensions/copilot/src/extension/byok/vscode-node/byokContribution.ts
sed -n '90,143p' extensions/copilot/package.json  # enabledApiProposals list

# Confirm the stable PrepareLanguageModelChatModelOptions has only `silent`
awk '/interface PrepareLanguageModelChatModelOptions/,/^\t}/' \
  <(git show 1.138.0:src/vscode-dts/vscode.d.ts)

# Confirm `configuration` is proposed
git grep -n "configuration" 1.138.0 -- src/vscode-dts/vscode.proposed.chatProvider.d.ts
```

## 9. Conclusion

Referencing Custom Endpoint is safe **provided the reference is at the level of architecture and workflow, not type signatures.** The provider skeleton (`languageModelChatProviders` contribution, `registerLanguageModelChatProvider`, `LanguageModelChatProvider`) is stable and identical to ours; the data exchange (`configuration`, `isBYOK`, `LanguageModelChatMessage2`, `LanguageModelResponsePart2`, `configurationSchema`) is proposed. `zenmux-copilot` already implements the correct isolation via `src/providerConfiguration.ts` and enforces it via `src/stableApiGuardrails.test.ts`. Continuing that pattern — stable imports, `unknown`-typed shims for proposed runtime fields, and a guardrail test — lets us absorb Copilot's engineering practices without inheriting its proposed-API coupling.

## 10. Referencing the OpenAI Responses API protocol implementation

This section answers a distinct question from the rest of the report: the earlier sections are about the *VS Code-facing seam* (stable vs proposed API); this section is about the *upstream-facing seam* (how the extension speaks to an OpenAI-compatible backend), specifically the **Responses API** protocol. The two are independent.

### 10.1 Key finding: Responses support needs zero VS Code API (stable or proposed)

The VS Code Language Model provider API is **protocol-agnostic**. `provideLanguageModelChatResponse(model, messages, options, progress, token)` hands the extension VS Code-typed messages and a `progress` sink for response parts. Which wire protocol the extension uses to reach its backend — Chat Completions, Responses, or Messages — is an entirely internal concern of the extension's own networking layer. Therefore:

- Adding Responses support is a **pure backend/protocol change**, at the same layer as our existing `openai` / `anthropic` / `vertex` transports.
- It requires **no proposed API** and touches **no VS Code API surface** beyond what we already use.

Evidence in the Copilot code (all extension-internal, no `vscode` import in the protocol path):

- Protocol selection: `extensions/copilot/src/platform/endpoint/node/chatEndpoint.ts` — the `useResponsesApi` getter keys off `modelMetadata.supported_endpoints` including `ModelSupportedEndpoint.Responses`; `createRequestBody(...)` branches to `createResponsesRequestBody(...)` when true.
- Protocol implementation: `extensions/copilot/src/platform/endpoint/node/responsesApi.ts` — `createResponsesRequestBody`, `OpenAIResponsesProcessor`, `processResponseFromChatEndpoint`.
- URL selection: `extensions/copilot/src/extension/byok/vscode-node/abstractLanguageModelChatProvider.ts` — picks `${url}/responses` vs `${url}/chat/completions` from `supported_endpoints`; `customEndpointProvider.ts` maps the user's `apiType` to those endpoints and resolves the URL.
- `ModelSupportedEndpoint.Responses = '/responses'` is defined in the extension's own `src/platform/endpoint/common/endpointProvider.ts`, not in `vscode`.

### 10.2 License: MIT, referencing/adaptation permitted with attribution

The bundled Copilot extension source is MIT-licensed: `extensions/copilot/LICENSE.txt` is a standard MIT License (Copyright Microsoft Corporation), and the individual source-file headers agree. The `package.json` `"license": "SEE LICENSE IN LICENSE.txt"` (publisher `GitHub`) is merely a pointer to that MIT file.

Practical implication: we may use, copy, modify, and adapt the source, **subject to the MIT condition of retaining the copyright and permission notice** in any copied *substantial portion*. Guidance:

- Referencing the design/protocol logic and re-implementing it: unrestricted.
- Copying a small standalone utility verbatim (for example an SSE parser): keep the Microsoft MIT header and add a `THIRD_PARTY_NOTICES` entry.
- Do not strip the notice from any substantial copied code.

### 10.3 Coupling: reference the blueprint, do not lift the files

The Responses implementation is **not** a standalone client; it is wired into Copilot's platform. From the imports of `responsesApi.ts`:

| Category | Copilot-internal dependencies (not wanted) |
| --- | --- |
| DI services | `IInstantiationService`, `IConfigurationService`, `IExperimentationService`, `ITelemetryService`, `ILogService` |
| Endpoint model | `IChatEndpoint`, `IEndpointBody`, `ICreateEndpointBodyOptions`, `ChatEndpoint` |
| Prompt/telemetry | `@vscode/prompt-tsx` `Raw`, `sendEngineMessagesTelemetry`, `TelemetryData` |
| Copilot-only features | context-management/compaction, tool-search, tool-deferral, WebSocket responses, stateful markers, thinking-data containers |

Consequently, "entirely reference" means **use it as the authoritative protocol spec and re-implement against our own transport layer**, not copy the files wholesale.

### 10.4 What to lift vs re-implement

| Part | Reuse strategy |
| --- | --- |
| Responses request-body shape (`createResponsesRequestBody`) | Reference as spec; port the field mapping, drop compaction/tool-search/telemetry branches. |
| Chat-Completions to Responses message translation (`messages` to Responses `input` items; tool calls to Responses function tools) | Reference and re-implement inside our own transport. |
| Responses SSE event to response-part parsing (`OpenAIResponsesProcessor` / `processResponseFromChatEndpoint`) | Reference the event-to-delta mapping; optionally reuse the pure `SSEParser` util (`util/vs/base/common/sseParser`, MIT) with its notice. |
| URL / `apiType` selection (`/responses` vs `/chat/completions`) | Trivial; extend our existing transport routing. |
| DI wiring, telemetry, compaction, WebSocket, tool-deferral | Do not port; Copilot-specific and unnecessary for basic Responses support. |

### 10.5 Critical protocol detail: reasoning effort placement

Chat Completions sends reasoning effort at the top level (`reasoning_effort`), whereas the Responses API nests it (`reasoning: { effort }`). Copilot's `byokProvider.ts` documents this (`'responses': nested reasoning.effort`), and the Custom Endpoint model config carries a `reasoningEffortFormat: 'chat-completions' | 'responses' | 'messages'` field to drive it. This intersects directly with our `src/reasoningDialect.ts`: to support Responses we must add a protocol/format dimension so a model's effort is serialized in the correct shape. The recently added exact profiles (`deepseek-v4.1-flash-openai`, `deepseek-v4-flash-0731-openai`, `deepseek-v4-pro-0813-openai`, `glm-5.3-forced-thinking`, `glm-5.3-flash-forced-thinking`) currently assume Chat Completions (`reasoningEffortControl: "openai-reasoning-effort"`, top-level); a Responses variant would nest the same effort levels.

### 10.6 Recommended implementation plan for zenmux-copilot

All achievable on stable API, mirroring our existing transports:

1. Add a `responses` transport module (for example `src/openai/responsesApi.ts`) alongside `src/openai/openaiApi.ts`, exposing the same request/stream interface `src/provider.ts` already calls.
2. Build the Responses request body by reference to `createResponsesRequestBody`, including nested `reasoning: { effort }`.
3. Parse the Responses SSE event stream into our existing progress/response-part emission by reference to `OpenAIResponsesProcessor`.
4. Extend transport/`apiType` routing to select `responses` and resolve the `/responses` URL; read `apiType` via the existing `src/providerConfiguration.ts` shim or settings (both stable).
5. Add a `reasoningEffortFormat` (or equivalent) dimension to `src/reasoningDialect.ts` so effort is serialized top-level for Chat Completions and nested for Responses; add unit tests analogous to the existing profile tests.
6. Keep the VS Code seam unchanged — no proposed API, no new `enabledApiProposals`; the stable-API guardrail test continues to hold.

### 10.7 Summary

The Responses protocol lives entirely on the extension-to-upstream seam, so it is fully referenceable and requires no proposed VS Code API. The source is MIT (retain notices on substantial copies). Because the Copilot implementation is coupled to its own DI/telemetry/prompt platform, the correct form of reference is to treat `responsesApi.ts` / `chatEndpoint.ts` as the protocol blueprint and re-implement a thin `responses` transport in our own codebase, extending `reasoningDialect.ts` for the nested-effort difference.
