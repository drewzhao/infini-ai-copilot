# InfiniAI Provider for VS Code

InfiniAI Provider for VS Code registers InfiniAI as a stable VS Code language model provider and adds an `@infiniai` diagnostics participant. The core provider path uses stable VS Code APIs and does not depend on the standalone `github.copilot-chat` extension or Copilot private APIs. The Marketplace manifest declares no proposed API dependency; the optional `LanguageModelThinkingPart` runtime probe is not required for `reasoning_content` replay correctness.

## Usage

1. Install the extension from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=drewzhao.infiniai-copilot).
2. Open VS Code Chat and use the model picker.
3. Choose **Manage Models...**, then add models from the **InfiniAI** provider.
4. Enter your InfiniAI API key. VS Code stores it as the secret for that provider group.
5. Select an InfiniAI model from the model picker.

VS Code provider groups are the only source of InfiniAI credentials. Each discovered model is bound to the group that
resolved it, so multiple InfiniAI groups can use different credentials. The provider returns cached models immediately
and performs model discovery in the background; an upstream timeout or failure therefore does not hold VS Code's
provider sequence open. Use **InfiniAI: Refresh Models** for an explicit, cancellable retry.

Thinking replay is resolved through capability profiles. The built-in round-trip defaults include MiMo V2, DeepSeek
V4, exact `deepseek-r1`, exact `deepseek-v3.2-thinking`, GLM 5/4.7, the verified Kimi K2.x IDs, exact `kimi-k3`, and
MiniMax patterns. Profiles that require replay fail locally when stale, conflicting, or missing replay context would
make a follow-up unsafe. Kimi K2.7 Code and K3 preserve reasoning for every historical assistant message, including
ordinary non-tool turns; tool-call profiles continue to use tool-call IDs as their primary correlation key. MiniMax
models always request split reasoning with `reasoning_split: true` and replay provider-native `reasoning_details`.
Start a new chat after changing the round-trip list.

Kimi K2.x/K3 and DeepSeek V4 default to the OpenAI-compatible Chat Completions route so preserved thinking uses the
verified provider-native request shape. If you manually route Kimi K2 or DeepSeek V4 through Anthropic Messages, the extension
uses conservative safe-off profiles that send `thinking: { "type": "disabled" }` and do not apply those model-id
round-trip defaults on that transport.

You can also use `@infiniai` in Chat for diagnostics:

- `@infiniai /doctor` checks resolved provider groups, endpoint settings, route override counts, cache state, and the last sanitized provider error.
- `@infiniai /models` lists discovered models, effective transports, route sources, and route capabilities from the local cache.
- `@infiniai /models refresh` refreshes model discovery before listing models.
- `@infiniai /test` picks a visible InfiniAI model and runs a minimal cancellable health request against its effective route.

The participant is diagnostic only. It is not a replacement chat assistant.

The InfiniAI activity bar also includes:

- A **Models** tree for provider-group status, model refresh, InfiniAI provider filtering, direct access to VS Code Manage Models, and per-model protocol switching.
- A **Local Usage** dashboard that records streamed request usage locally, exports CSV, and clears records through a native VS Code confirmation dialog.

## Requirements

- VS Code `^1.130.0`
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

1. Open this repository in VS Code `1.130+`.
2. Press `F5` to launch the Extension Development Host.
3. In the development host, use the model picker to add InfiniAI models or run `@infiniai /doctor`.

## Activation And Logging

The manifest keeps activation lazy. VS Code automatically activates the extension when its stable language model
provider or chat participant contribution is needed, or when an InfiniAI view or command is opened.

Logs are written to a VS Code `LogOutputChannel` named `InfiniAI`. The extension redacts secrets, prompts, tool results, image data, auth headers, and full response bodies.

Useful log fields include request id, model id, provider transport, endpoint host/path, HTTP status, retry attempt, elapsed time, streamed bytes, and finish reason.

## Configuration

Common settings:

- `infiniai.baseUrl`: OpenAI-compatible API base URL. Defaults to `https://cloud.infini-ai.com/maas/v1`.
- `infiniai.anthropic.baseUrl`: Anthropic-compatible API base URL. Defaults to `https://cloud.infini-ai.com/maas`.
- `infiniai.modelDiscoveryUrl`: Optional absolute URL for model discovery. Empty uses `https://cloud.infini-ai.com/maas/v1/models`.
- `infiniai.modelDiscoveryTimeoutMs`: Full model-discovery timeout, including response-body download and parsing. Defaults to 15 seconds.
- `infiniai.modelCacheTtlMs`: Model discovery cache TTL in milliseconds. Set `0` to refresh every request.
- `infiniai.modelRoutes`: Optional model routing overrides. Each item supports `pattern`, `transport` (`"openai"`, `"anthropic"`, or `"vertex"`), and optional `baseUrl`. The **InfiniAI: Switch Model Protocol** command is the safer editor for exact OpenAI/Anthropic per-model overrides.
- `infiniai.imageInputModels`: Force-enable image input for matching model IDs. Supports `*` wildcards.
- `infiniai.disableImageInputModels`: Force-disable image input for matching model IDs. Supports `*` wildcards.
- `infiniai.toolCallingModels`: Force-enable tool calling and VS Code Agent eligibility for matching model IDs. The
  extension already has exact evidence-based fallbacks for DeepSeek V4 and MiMo IDs verified by API probes but not
  marked as tool-capable in the catalog. An explicit live/catalog value remains authoritative unless this user setting
  overrides it.
- `infiniai.disableToolCallingModels`: Force-disable tool calling and Agent eligibility. This list wins over `infiniai.toolCallingModels`. Models with no live, catalog, or user confirmation default to no tool calling instead of being advertised optimistically.
- `infiniai.disableThinkingForModels`: Safety list. Thinking mode is disabled by default for matching model IDs to avoid known `reasoning_content` HTTP 400 errors. The built-in defaults include known Xiaomi MiMo V2 model IDs and the DeepSeek V4 family: `mimo-v2-pro`, `mimo-v2.5-pro`, `mimo-v2.5`, `mimo-v2-omni`, `mimo-v2-flash`, `deepseek-v4*`. See [Thinking mode](#thinking-mode) below.
- `infiniai.enableThinkingRoundTripForModels`: Round-trip replay list. Kimi and DeepSeek V4 defaults use exact verified IDs—Kimi uses `kimi-k2-thinking`, `kimi-k2.5`, `kimi-k2.6`, `kimi-k2.7-code`, `kimi-k2.7-code-highspeed`, and `kimi-k3`; DeepSeek V4 uses `deepseek-v4-pro` and `deepseek-v4-flash`. Other defaults are `mimo-v2*`, exact `deepseek-r1`, exact `deepseek-v3.2-thinking`, `glm-5*`, `glm-4.7*`, and `minimax*`; user patterns extend the list but a model still needs a known replay profile. Known adapters preserve the provider-native shape: OpenAI `reasoning_content` for MiMo V2, DeepSeek V4, DeepSeek R1, GLM, Kimi, and Qwen profiles; OpenAI `reasoning_details` for MiniMax split mode; and Anthropic `thinking` blocks for Anthropic Messages routes that safely support them. Replay-required profiles fail locally when replay data is missing, expired, conflicting, or unavailable. Supports `*` wildcards.
- `infiniai.thinkingReplayStore`: Replay storage backend for profile-enabled or opted-in thinking replay. Defaults to `"localPlaintext"` for restart continuity; set `"memory"` to avoid writing replay data to disk and accept no restart continuity.
- `infiniai.retry`: Retry policy for retryable network and HTTP failures.
- `infiniai.delay`: Fixed delay between requests, in milliseconds.

Model visibility has two independent layers:

1. The InfiniAI provider filter (`infiniai.hiddenModels`, `infiniai.hiddenModelPatterns`, and
   `infiniai.visibleModels`) controls which discovered models the extension returns to VS Code. The Models tree edits
   this layer.
2. **VS Code Manage Models** controls whether a returned model is shown in VS Code pickers. Use
   **InfiniAI: Open VS Code Manage Models** for this layer.

An extension-filtered model cannot appear in Manage Models because VS Code never receives it. Conversely, a model
hidden in Manage Models can still appear as included in the InfiniAI Models tree.

## Model Picker Controls

The extension exposes stable-safe model configuration through VS Code:

- **Max output tokens** appears in **Manage Models** and caps the response length. The model default sends no cap.
  Persisted values above a model's current advertised maximum are ignored rather than sent upstream.
- **Prompt budget** is advertised separately from the provider's absolute max completion window. Long-context models keep a practical 16K output reserve for interactive chat, so Copilot Chat does not compact early just because a provider allows very large completions.
- **Reasoning effort** appears in **Manage Models** and, for the selected model, in VS Code's inline **Thinking
  Effort** control. It is offered only for profiles with a confirmed effort parameter. Kimi K3 offers `Low`, `High`,
  and `Max` through top-level `reasoning_effort`, with `Max` as its automatic replay-safe default.
  OpenAI-compatible DeepSeek V4 and GLM-5.2 offer only `High` and `Max`; Anthropic-routed DeepSeek V3.2 profiles keep
  `Low`, `Medium`, and `High`, mapping selected values to `output_config.effort`.
- **Thinking mode** appears in **Manage Models** only and only for profiles with a confirmed current-turn thinking
  control. Kimi K2.5 and K2.6 expose `Enabled`/`Disabled` through `thinking.type`; K2.7 Code and K3 expose no toggle
  because thinking is mandatory. Qwen maps to `enable_thinking`, OpenAI-compatible GLM/MiMo/DeepSeek V4 maps to
  `thinking.type`, and Anthropic DeepSeek V3.2 maps to the Anthropic `thinking` object. Confirmed Claude Opus
  4.6/4.7 and Sonnet 4.6 profiles map `Enabled` to adaptive thinking; `claude-sonnet-4-5-20250929` maps `Enabled` to
  budgeted extended thinking.

The stored value named `unset` is displayed as **Automatic**. Automatic does not always mean “send nothing”: a
profile may apply a verified safety default, replay-preservation control, or default reasoning effort. An explicit
effort is ignored while thinking is disabled.

VS Code renders these controls after model discovery returns the model's configuration schema. The inline reasoning
control updates when that model is selected; Manage Models shows the complete schema. A changed value is included in
the next request, not retroactively applied to a request already in flight.

Vertex routes map max output tokens into `generationConfig.maxOutputTokens`.

These controls use VS Code Stable's runtime-accepted model configuration surface and do not require the extension manifest to declare proposed APIs.

### Agents window

Tool-capable third-party InfiniAI models remain eligible for VS Code Agent experiences. Capability metadata and the
`infiniai.toolCallingModels` / `infiniai.disableToolCallingModels` overrides determine that eligibility; unknown models
are not marked Agent-capable by default. In VS Code 1.130 this path also requires the agent host and its default-on
`chat.agentHost.byokModels.enabled` bridge; changing either agent-host setting requires an agent-host restart.

In VS Code 1.130, the Agents-window BYOK bridge carries the model identity, context, vision, and request path, but not
the per-model configuration schema. Consequently, InfiniAI controls do not render inside the Agents-window model
picker. Values saved earlier through the normal **Manage Models** UI are still merged into requests for the original
model. Configure the model there first when an Agents session needs non-automatic reasoning, thinking, or output
settings.

The same bridge uses `vendor/model` as its external selection key, so two InfiniAI provider groups that expose the same
model ID are not reliably distinguishable in the Agents window. Use a single InfiniAI group for that model in Agent
experiences; the standard VS Code model picker still preserves each provider group's credential binding.

## Routing And Protocol Switching

Routing precedence:

1. User `infiniai.modelRoutes` pattern match.
2. Provider-owned route preferences such as Kimi K2.x/K3 and DeepSeek V4 OpenAI-compatible defaults.
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

The Models tree tooltip shows the effective transport, route source (`user`, `metadata`, `catalog`, or `heuristic`), endpoint kind, InfiniAI provider-filter status, the separate VS Code Manage Models boundary, and core capabilities. `@infiniai /models` includes the route source column, and `@infiniai /doctor` reports both total route overrides and exact per-model route overrides.

## Thinking mode

Some InfiniAI thinking models return provider-private reasoning in addition to the regular assistant text. Several
provider APIs require that prior reasoning be echoed back in the same provider-native shape on subsequent turns.
Some require it after tool calls; Kimi K2.7 Code and K3 require complete historical assistant messages in ordinary
multi-turn conversations too. If required reasoning is missing, the upstream may return:

```
HTTP 400 — reasoning_content is required when the previous assistant message contains tool calls
```

The stable VS Code language-model API (`vscode.LanguageModelChatMessage`) has no public part type for thinking/reasoning content. The source keeps an optional runtime detector for `LanguageModelThinkingPart`, but the Marketplace build no longer declares `enabledApiProposals`; replay correctness is handled by the extension-owned replay store on both VS Code Stable and Insiders.

Replay is family-specific, not one flat `reasoning_content` switch:

- OpenAI-compatible MiMo V2, DeepSeek V4, DeepSeek R1, GLM, Kimi, and Qwen profiles replay `assistant.reasoning_content`.
- GLM preservation adds `thinking.clear_thinking: false`; Kimi K2.6 preservation adds exactly `thinking: { "type": "enabled", "keep": "all" }`; Qwen preservation adds `preserve_thinking: true`.
- Kimi K2.5 supports a thinking toggle but no `thinking.keep`. K2.7 Code always thinks and preserves history, normally omits `thinking`, and does not accept `reasoning_effort`. K3 always thinks, never accepts K2.x `thinking`, and uses top-level `reasoning_effort` with `low`, `high`, or `max`.
- For K2.6 keep-all, K2.7 Code, and K3, ordinary assistant turns are correlated through deterministic transcript fingerprints. Ambiguous fingerprints fail locally instead of replaying the wrong hidden reasoning. Tool-call turns continue to use provider call IDs.
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
- `infiniai.enableThinkingRoundTripForModels` is pre-populated for verified replay-capable profiles. Kimi entries use the exact IDs listed in [Configuration](#configuration), including K3 and excluding unverified `-test` variants. The base `"deepseek-v3.2"` stays out of the default because it defaults to no thinking. Replay-required profiles continue only when preflight proves the required provider-native reasoning shape is available.
- Keep `infiniai.thinkingReplayStore` at the default `"localPlaintext"` if you want replay-sensitive conversations to survive VS Code reload or restart while cache entries remain valid. Choose `"memory"` only if you do not want replay data written to disk and can tolerate losing restart continuity.
- Run `InfiniAI: Clear Thinking Replay Cache` to remove the active replay cache.

Replay behavior is transport-aware:

- OpenAI-compatible routes capture streamed `reasoning_content` and inject it into the prior assistant message before
  replay-sensitive follow-up requests. Whole-history Kimi profiles also fingerprint ordinary assistant turns so their
  reasoning can be restored when VS Code supplies only stable text/tool parts.
- MiniMax OpenAI-compatible routes capture streamed `reasoning_details` and inject it into the prior assistant message as
  `reasoning_details`.
- Anthropic Messages routes capture streamed `thinking` blocks, including optional signatures when present, and inject a
  matching `thinking` block before the prior assistant `tool_use` block.

This means Claude-compatible InfiniAI models such as `mimo-v2.5-pro` can be switched between OpenAI Chat Completions and
Anthropic Messages without losing the replay guard, as long as the required replay cache entry still exists.

## Commands

- `infiniai.refreshModels`: Cancel active discovery and explicitly retry the resolved InfiniAI provider groups.
- `infiniai.openManageModels`: Open VS Code Manage Models.
- `infiniai.openLogs`: Open the InfiniAI output channel.

Chat participant commands:

- `@infiniai /doctor`
- `@infiniai /models`
- `@infiniai /models refresh`
- `@infiniai /test`

## Stable API Policy

The Marketplace manifest declares no `enabledApiProposals` and contains no proposed-API launch flags.

The provider uses stable VS Code contribution points plus a small, audited stable-gray surface that is accepted by current VS Code Stable builds:

- `isBYOK` exports confirmed tool-capable InfiniAI models to the Agents-window bridge.
- `isUserSelectable` keeps eligible InfiniAI models visible in the picker.
- `configurationSchema` exposes the complete controls in Manage Models and the reasoning-effort control inline.
- Runtime request options `configuration` / `modelConfiguration` carry selected model controls back to the provider.

These fields are centralized in `src/grayLanguageModelMetadata.ts` and covered by `npm run validate:stable-gray`.
The same guard checks the VS Code 1.130 source bridge used by the Agents window; it currently documents and verifies
the schema-transfer limitation described above. Revalidate this surface on every VS Code Stable update.

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
3. Open **VS Code Manage Models**, confirm that an InfiniAI provider group exists, and use **Update API Key** if needed.
4. Check `infiniai.modelDiscoveryUrl` and route overrides.
5. Run **InfiniAI: Refresh Models**. Reload the window only if the provider group itself does not re-resolve.

## Troubleshooting

### Upgrade From An Older Version

VS Code may leave older extension version folders on disk, but it scans installed extensions by identifier and loads the latest valid version. Old proposed API files or old source files should not affect this release because the VSIX packages only compiled runtime files from `out/`.

Persistent VS Code state can still affect upgraded installs:

- InfiniAI credentials are read only from VS Code provider groups. Add InfiniAI through **Manage Models** if no group
  exists after upgrading from a release that used extension-managed credentials.
- Current base URLs, `infiniai.modelDiscoveryUrl`, and `infiniai.modelRoutes` remain effective. User-supplied route and discovery overrides are not rewritten.
- Already-open windows may keep the old extension host running until reload.

After upgrading, run:

```text
@infiniai /doctor
@infiniai /models refresh
```

If the diagnostics show an unexpected endpoint or route override, reset the corresponding current `infiniai.*` setting and reload the window.

### No Models Appear

Check these in order:

1. Open **VS Code Manage Models**, add InfiniAI if needed, and confirm the provider group's API key.
2. Run `@infiniai /doctor` and verify the provider-group status, discovery endpoint, and last error.
3. Clear `infiniai.modelDiscoveryUrl` unless you intentionally use a custom discovery endpoint.
4. Temporarily clear `infiniai.modelRoutes` to rule out a bad route override.
5. Run **InfiniAI: Refresh Models**. The operation is cancellable and a failure includes direct **Manage Models** and
   **Open Logs** remedies.

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
