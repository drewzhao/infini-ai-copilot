# InfiniAI Provider for VS Code

InfiniAI Provider for VS Code registers InfiniAI as a stable VS Code language model provider and adds an `@infiniai` diagnostics participant. The core provider path uses stable VS Code APIs and does not depend on the standalone `github.copilot-chat` extension or Copilot private APIs. The Marketplace manifest declares no proposed API dependency; the optional `LanguageModelThinkingPart` runtime probe is not required for `reasoning_content` replay correctness.

## Usage

1. Install the extension from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=drewzhao.infiniai-copilot).
2. Open VS Code Chat and use the model picker.
3. Choose **Manage Models...**, then add models from the **InfiniAI** provider.
4. Pick the Standard or Coding plan when prompted.
5. Enter the matching InfiniAI API key. The key is stored in VS Code Secret Storage.
6. Select an InfiniAI model from the model picker.

Thinking replay is resolved through model-family profiles. The built-in round-trip defaults include MiMo V2, DeepSeek
V4, exact `deepseek-r1`, exact `deepseek-v3.2-thinking`, GLM 5/4.7, Kimi K2, and MiniMax patterns, so new tool-call chats
can preserve thinking by default while stale or missing replay context still fails locally before an unsafe upstream
request. MiniMax models always request split reasoning with `reasoning_split: true` and replay provider-native
`reasoning_details`. Start a new chat after changing the round-trip list.

Kimi K2 and DeepSeek V4 default to the OpenAI-compatible Chat Completions route so preserved thinking uses the verified
provider-native request shape. If you manually route Kimi K2 or DeepSeek V4 through Anthropic Messages, the extension
uses conservative safe-off profiles that send `thinking: { "type": "disabled" }` and do not apply those model-id
round-trip defaults on that transport.

You can also use `@infiniai` in Chat for diagnostics:

- `@infiniai /doctor` checks configuration, key presence, endpoint settings, route override counts, cache state, and the last sanitized provider error.
- `@infiniai /models` lists discovered models, effective transports, route sources, and route capabilities from the local cache.
- `@infiniai /models refresh` refreshes model discovery before listing models.
- `@infiniai /test` picks a visible InfiniAI model and runs a minimal cancellable health request against its effective route.

The participant is diagnostic only. It is not a replacement chat assistant.

The InfiniAI activity bar also includes:

- A **Models** tree for plan switching, model refresh, picker visibility, and per-model protocol switching.
- A **Local Usage** dashboard that records streamed request usage locally, exports CSV, and clears records through a native VS Code confirmation dialog.

## Requirements

- VS Code `^1.117.0`
- A valid InfiniAI API key from [infiniai.ai](https://infiniai.ai)
- Node.js and npm for local development

The extension uses VS Code's built-in Chat and language model provider APIs. No standalone Copilot Chat extension is required.

## Development

This repository uses npm as the only package manager.

```bash
npm ci
npm run lint
npx prettier --check .
npm run compile
npm test
npm run catalog:normalize
npm run build
```

`npm run catalog:normalize` parses the static snapshot at `reports/list-models.json` and regenerates built-in model metadata under `src/generated/`. The extension does not fetch that file at runtime.

To run the extension locally:

1. Open this repository in VS Code `1.117+`.
2. Press `F5` to launch the Extension Development Host.
3. In the development host, use the model picker to add InfiniAI models or run `@infiniai /doctor`.

## Activation And Logging

The manifest keeps activation lazy. VS Code automatically activates the extension when its stable language model provider or chat participant contribution is needed, or when `infiniai.setApikey` is invoked.

Logs are written to a VS Code `LogOutputChannel` named `InfiniAI`. The extension redacts secrets, prompts, tool results, image data, auth headers, and full response bodies.

Useful log fields include request id, model id, provider transport, endpoint host/path, HTTP status, retry attempt, elapsed time, streamed bytes, and finish reason.

## Configuration

Common settings:

- `infiniai.plan`: Select `"standard"` or `"coding"`. If unset, routing defaults to `"standard"` and the key-entry flow prompts for a plan.
- `infiniai.baseUrl`: OpenAI-compatible Standard Plan base URL.
- `infiniai.anthropic.baseUrl`: Anthropic-compatible Standard Plan base URL.
- `infiniai.coding.baseUrl`: OpenAI-compatible Coding Plan base URL.
- `infiniai.coding.anthropic.baseUrl`: Anthropic-compatible Coding Plan base URL.
- `infiniai.modelDiscoveryUrl`: Optional absolute URL for model discovery. Empty uses the selected InfiniAI plan default.
- `infiniai.modelCacheTtlMs`: Model discovery cache TTL in milliseconds. Set `0` to refresh every request.
- `infiniai.modelRoutes`: Optional model routing overrides. Each item supports `pattern`, `transport` (`"openai"`, `"anthropic"`, or `"vertex"`), and optional `baseUrl`. The **InfiniAI: Switch Model Protocol** command is the safer editor for exact OpenAI/Anthropic per-model overrides.
- `infiniai.imageInputModels`: Force-enable image input for matching model IDs. Supports `*` wildcards.
- `infiniai.disableImageInputModels`: Force-disable image input for matching model IDs. Supports `*` wildcards.
- `infiniai.disableThinkingForModels`: Safety list. Thinking mode is disabled by default for matching model IDs to avoid known `reasoning_content` HTTP 400 errors. The built-in defaults include known Xiaomi MiMo V2 model IDs and the DeepSeek V4 family: `mimo-v2-pro`, `mimo-v2.5-pro`, `mimo-v2.5`, `mimo-v2-omni`, `mimo-v2-flash`, `deepseek-v4*`. See [Thinking mode](#thinking-mode) below.
- `infiniai.enableThinkingRoundTripForModels`: Round-trip replay list. The built-in defaults are `mimo-v2*`, `deepseek-v4*`, exact `deepseek-r1`, exact `deepseek-v3.2-thinking`, `glm-5*`, `glm-4.7*`, `kimi-k2*`, and `minimax*`; user patterns extend that list. The base `deepseek-v3.2` model is not enabled by default because it defaults to no thinking. Known adapters preserve the provider-native shape: OpenAI `reasoning_content` for MiMo V2, DeepSeek V4, DeepSeek R1, GLM, Kimi, and Qwen profiles; OpenAI `reasoning_details` for MiniMax split mode; and Anthropic `thinking` blocks for Anthropic Messages routes that safely support them. Kimi K2 and DeepSeek V4 built-in replay defaults apply to their OpenAI-compatible routes; manually routed Anthropic Kimi and catalog/default Anthropic DeepSeek V4 requests use safe-off profiles instead. If replay data is missing, expired, conflicting, or unavailable, the extension fails locally to avoid HTTP 400. Supports `*` wildcards.
- `infiniai.thinkingReplayStore`: Replay storage backend for profile-enabled or opted-in thinking replay. Defaults to `"localPlaintext"` for restart continuity; set `"memory"` to avoid writing replay data to disk and accept no restart continuity.
- `infiniai.retry`: Retry policy for retryable network and HTTP failures.
- `infiniai.delay`: Fixed delay between requests, in milliseconds.

## Model Picker Controls

The extension exposes stable-safe model controls in VS Code's model picker:

- **Max output tokens** caps the response length. The model default sends no cap.
- **Reasoning effort** appears only for profiles with a confirmed effort parameter. `Unset` sends no effort. OpenAI-compatible DeepSeek V4 maps selected values to `reasoning_effort`; Anthropic-routed DeepSeek V3.2 profiles map selected values to `output_config.effort`.
- **Thinking mode** appears only for model profiles with a confirmed current-turn thinking control. It offers `Unset` plus the supported `Disabled` and/or `Enabled` choices. Qwen maps to `enable_thinking`, OpenAI-compatible GLM/Kimi/MiMo/DeepSeek V4 maps to `thinking.type`, and Anthropic DeepSeek V3.2 maps to the Anthropic `thinking` object. Manually routed Anthropic Kimi and Anthropic DeepSeek V4 show only the safe `Disabled` choice. DeepSeek R1 and MiniMax do not expose a disable/enable toggle because no reliable disable field is confirmed.

Vertex routes map max output tokens into `generationConfig.maxOutputTokens`.

These controls use VS Code Stable's runtime-accepted model configuration surface and do not require the extension manifest to declare proposed APIs.

## Routing And Protocol Switching

Routing precedence:

1. User `infiniai.modelRoutes` pattern match.
2. Provider-owned route preferences such as Kimi K2 and DeepSeek V4 OpenAI-compatible defaults.
3. Explicit InfiniAI model metadata.
4. Provider-owned catalog metadata.
5. Conservative OpenAI-compatible fallback.

Transport behavior:

- OpenAI-compatible routes call `/chat/completions`.
- Anthropic routes call `/v1/messages` with `x-api-key` and `anthropic-version`.
- Vertex routes call `:streamGenerateContent` using the Vertex adapter.

Unsupported endpoint families fail with a clear provider error instead of silently falling back.

For Claude-compatible InfiniAI models, use **InfiniAI: Switch Model Protocol** from the Command Palette or from a model row in the InfiniAI Models view. The command:

- Offers only **OpenAI Chat Completions** and **Anthropic Messages**.
- Writes an exact `{ pattern: modelId, transport }` override to global `infiniai.modelRoutes`.
- Places exact overrides before broader matching wildcards and removes duplicate exact entries.
- Drops stale `baseUrl` from UI-created exact overrides so a protocol change cannot keep an incompatible endpoint.
- Offers **Reset exact override** when an exact override exists. Reset removes only that exact entry; any matching wildcard or catalog/default route is then shown in the confirmation.

The Models tree tooltip shows the effective transport, route source (`user`, `metadata`, `catalog`, or `heuristic`), endpoint kind, picker visibility, and core capabilities. `@infiniai /models` includes the route source column, and `@infiniai /doctor` reports both total route overrides and exact per-model route overrides.

## Thinking mode

Some InfiniAI thinking models return provider-private reasoning in addition to the regular assistant text. Several
provider APIs require that prior reasoning be echoed back in the same provider-native shape on subsequent turns whenever
the conversation contains tool calls. If it is missing, the upstream may return:

```
HTTP 400 — reasoning_content is required when the previous assistant message contains tool calls
```

The stable VS Code language-model API (`vscode.LanguageModelChatMessage`) has no public part type for thinking/reasoning content. The source keeps an optional runtime detector for `LanguageModelThinkingPart`, but the Marketplace build no longer declares `enabledApiProposals`; replay correctness is handled by the extension-owned replay store on both VS Code Stable and Insiders.

Replay is family-specific, not one flat `reasoning_content` switch:

- OpenAI-compatible MiMo V2, DeepSeek V4, DeepSeek R1, GLM, Kimi, and Qwen profiles replay `assistant.reasoning_content`.
- GLM preservation adds `thinking.clear_thinking: false`, Kimi preservation adds `thinking.keep: true`, and Qwen preservation adds `preserve_thinking: true`.
- MiniMax split profiles always send `reasoning_split: true`, capture streamed `reasoning_details`, and replay `assistant.reasoning_details` when round-trip replay is enabled.
- Anthropic Messages routes capture and replay `thinking` blocks, including signatures when present, before the prior `tool_use` block. Provider profiles can still disable this path when probes show thinking plus tools is unsafe.

To avoid the 400 error out of the box, the extension still force-disables thinking mode for the known unsafe-by-default model IDs/families by injecting the profile-supported disable control into the request body. For the built-in MiMo V2 and DeepSeek V4 safety defaults, that is:

```jsonc
{
  "thinking": { "type": "disabled" }
}
```

Built-in safety defaults: `mimo-v2-pro`, `mimo-v2.5-pro`, `mimo-v2.5`, `mimo-v2-omni`, `mimo-v2-flash` (known Xiaomi MiMo V2 model IDs), and `deepseek-v4*` (any DeepSeek V4 variant). Anthropic-routed DeepSeek V4 is additionally safe-off by profile because live probes showed `thinking: enabled` plus tools can produce invalid Anthropic tool streams.

**Trade-off**: chain-of-thought quality on these specific models. Tool-calling and regular replies still work normally; other models (Kimi K2 Thinking, DeepSeek R1, DeepSeek V3.x, Qwen, GLM, etc.) are not affected and keep their thinking mode.

Configure the guard with these settings:

- Add a pattern to `infiniai.disableThinkingForModels` (e.g. `"my-thinker-*"`) to extend the safety list. User patterns are additive; they do not remove the built-in safety defaults. Regular users should usually leave this setting unchanged.
- `infiniai.enableThinkingRoundTripForModels` is pre-populated for the verified replay-capable patterns: `"mimo-v2*"`, `"deepseek-v4*"`, `"deepseek-r1"`, `"deepseek-v3.2-thinking"`, `"glm-5*"`, `"glm-4.7*"`, `"kimi-k2*"`, and `"minimax*"`. The base `"deepseek-v3.2"` model stays out of the default because it defaults to no thinking. Transport profiles can decline a model-id default; for example, Anthropic-routed DeepSeek V4 stays safe-off even though OpenAI-compatible DeepSeek V4 remains replay-enabled. Add patterns only when another family has a verified replay adapter. Replay continues only when preflight proves the required provider-native reasoning shape is available. If replay data is missing, expired, conflicting, or unavailable, the extension fails locally instead of sending an unsafe request that would return HTTP 400.
- Keep `infiniai.thinkingReplayStore` at the default `"localPlaintext"` if you want opted-in thinking tool-call conversations to survive VS Code reload or restart while cache entries remain valid. Choose `"memory"` only if you do not want replay data written to disk and can tolerate losing restart continuity.
- Run `InfiniAI: Clear Thinking Replay Cache` to remove the active replay cache.

Replay behavior is transport-aware:

- OpenAI-compatible routes capture streamed `reasoning_content` and inject it into the prior assistant message before
  replay-sensitive follow-up requests.
- MiniMax OpenAI-compatible routes capture streamed `reasoning_details` and inject it into the prior assistant message as
  `reasoning_details`.
- Anthropic Messages routes capture streamed `thinking` blocks, including optional signatures when present, and inject a
  matching `thinking` block before the prior assistant `tool_use` block.

This means Claude-compatible InfiniAI models such as `mimo-v2.5-pro` can be switched between OpenAI Chat Completions and
Anthropic Messages without losing the replay guard, as long as the required replay cache entry still exists.

## Commands

- `infiniai.setApikey`: Set, update, or delete the Standard or Coding plan API key.

Chat participant commands:

- `@infiniai /doctor`
- `@infiniai /models`
- `@infiniai /models refresh`
- `@infiniai /test`

## Stable API Policy

The Marketplace manifest declares no `enabledApiProposals` and contains no proposed-API launch flags.

The provider uses stable VS Code contribution points plus a small, audited stable-gray surface that is accepted by current VS Code Stable builds:

- `isUserSelectable` keeps eligible InfiniAI models visible in the picker.
- `configurationSchema` exposes model picker controls for max output tokens, reasoning effort, and thinking mode.
- Runtime request options `configuration` / `modelConfiguration` carry selected model controls back to the provider.

These fields are centralized in `src/grayLanguageModelMetadata.ts` and covered by `npm run validate:stable-gray`.

This extension intentionally avoids hard proposal-gated surfaces:

- Copilot private commands or extension IDs
- `chatParticipantAdditions`
- `defaultChatParticipant`
- `languageModelProxy`
- `targetChatSessionType`
- `requiresAuthorization`
- `isDefault`
- `editTools`

A guarded runtime detector for `LanguageModelThinkingPart` remains for development/custom hosts, but replay correctness and HTTP 400 mitigation do not depend on proposed APIs.

## Debugging

If InfiniAI models do not appear:

1. Run `@infiniai /doctor`.
2. Check the `InfiniAI` output channel.
3. Confirm that the correct plan key is stored with `infiniai.setApikey`.
4. Check `infiniai.modelDiscoveryUrl` and route overrides.
5. Run `Developer: Reload Window` and retry model discovery.

## Troubleshooting

### Upgrade From An Older Version

VS Code may leave older extension version folders on disk, but it scans installed extensions by identifier and loads the latest valid version. Old proposed API files or old source files should not affect this release because the VSIX packages only compiled runtime files from `out/`.

Persistent VS Code state can still affect upgraded installs:

- API keys in Secret Storage are preserved: `infiniai.apiKey` and `infiniai.codingApiKey`.
- User/workspace settings are preserved, including `infiniai.plan`, base URLs, `infiniai.modelDiscoveryUrl`, and `infiniai.modelRoutes`.
- Already-open windows may keep the old extension host running until reload.

After upgrading, run:

```text
@infiniai /doctor
@infiniai /models refresh
```

If the diagnostics show an unexpected endpoint, plan, or route override, reset the corresponding `infiniai.*` setting and reload the window.

### No Models Appear

Check these in order:

1. Run `InfiniAI: Set InfiniAI API Key` and confirm the key is stored for the active plan.
2. Run `@infiniai /doctor` and verify the active plan, key presence, discovery endpoint, and last error.
3. Clear `infiniai.modelDiscoveryUrl` unless you intentionally use a custom discovery endpoint.
4. Temporarily clear `infiniai.modelRoutes` to rule out a bad route override.
5. Run `Developer: Reload Window`, then `@infiniai /models refresh`.

### Requests Fail For Anthropic Or Vertex Routes

Route overrides are exact product behavior. If a route is forced to `anthropic`, the extension sends `/v1/messages`; if it is forced to `vertex`, the extension sends `:streamGenerateContent`. Make sure the configured `baseUrl` matches the selected transport.

For a quick isolation test, remove the matching item from `infiniai.modelRoutes` and let the extension fall back to model metadata or the OpenAI-compatible route.

### Logs Need To Be Shared

Use the `InfiniAI` output channel, but redact before sharing. Logs are designed to avoid API keys, prompts, tool results, image data, auth headers, and full response bodies. Still review them for organization-specific endpoint names or model IDs.

## Contributing

Issues and pull requests are welcome:

- [GitHub Issues](https://github.com/drewzhao/infini-ai-copilot/issues)

See [CONTRIBUTE.md](CONTRIBUTE.md) for architecture and release guardrails.

## License

[MIT License](LICENSE)
