# InfiniAI Provider for VS Code

InfiniAI Provider for VS Code registers InfiniAI as a stable VS Code language model provider and adds an `@infiniai` diagnostics participant. The core provider path uses stable VS Code APIs and does not depend on the standalone `github.copilot-chat` extension or Copilot private APIs. The Marketplace manifest declares no proposed API dependency; the optional `LanguageModelThinkingPart` runtime probe is not required for `reasoning_content` replay correctness.

## Documentation

- [Quick start](#quick-start)
- [Provider groups and Group Name](#provider-groups-and-group-name)
- [API key management](#api-key-management)
- [Configuration](#configuration)
- [Model controls and Agents](#model-picker-controls)
- [Routing and protocol switching](#routing-and-protocol-switching)
- [Thinking and replay](#thinking-mode)
- [Common procedures](#common-procedures)
- [Command reference](#command-reference)
- [Troubleshooting](#troubleshooting)

## Quick start

1. Install the extension from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=drewzhao.infiniai-copilot).
2. Open the Command Palette (`Cmd+Shift+P` on macOS or `Ctrl+Shift+P` on Windows/Linux) and run **InfiniAI: Add Provider Group**. Read the Group Name guide, then select **Open Language Models**.
3. In the Language Models window, select **Add Models**, then **InfiniAI**.
4. Accept the default **Group Name** `InfiniAI` when using one API key, or enter a descriptive name such as `Work` or `Personal` when using multiple keys. Then enter your InfiniAI API key.
5. Return to Chat and select an InfiniAI model from the model picker.

VS Code provider groups are the only source of InfiniAI credentials. The provider returns cached models immediately
and performs model discovery in the background, so an upstream timeout or failure does not hold VS Code's provider
sequence open. Run **InfiniAI: Refresh Models** for an explicit, cancellable retry.

### Provider groups and "Group Name"

After you select **Add Models** > **InfiniAI**, VS Code asks for a **Group Name** before it asks for the API key.
This is a built-in VS Code language-model concept: the name is a local label and namespace for one configured instance
of the InfiniAI provider. It is not an InfiniAI API field, is not sent to InfiniAI, and does not affect request behavior
or API-key validity.

VS Code owns that popup and does not let providers customize its title, placeholder, or helper text. Use **InfiniAI:
Add Provider Group** for an explanation immediately before opening the Language Models window. You can revisit the same
guidance through **Help: Get Started** > **Get Started with InfiniAI**.

Provider groups provide three benefits:

- Multiple InfiniAI accounts or API keys can coexist in one VS Code installation. Models discovered with a key remain
  bound to that key's group.
- **Update API Key**, **Rename Group**, **Delete**, model visibility, and per-model settings can target the intended
  configured instance.
- The normal VS Code model picker can present groups separately when the same InfiniAI model ID is available through
  more than one credential.

Choose a group name as follows:

1. For one InfiniAI API key, keep the prefilled name `InfiniAI`.
2. For multiple keys, use a short purpose-based name such as `Work`, `Personal`, or `Team A`. Names must be unique among
   InfiniAI groups.
3. Do not put an API key or other secret in the name. Group names are visible in VS Code's UI and non-secret
   configuration.
4. Rename the group later through **Rename Group** if its purpose changes. Renaming changes the local label, not the API
   key or upstream InfiniAI account.

For this extension, the API key is group-specific. Settings such as `infiniai.baseUrl`, `infiniai.modelDiscoveryUrl`,
and `infiniai.modelRoutes` remain ordinary VS Code settings and are not independently scoped to each group.

The standard VS Code model picker preserves group-to-credential bindings. The Agents window cannot reliably distinguish
two InfiniAI groups that expose the same model ID, so use only one group for that model in Agent experiences.

### API key management

Manage provider groups and credentials in VS Code's Language Models window, not in InfiniAI Settings:

| Goal                                    | Procedure                                                                                                                                                                                                                   |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add an API key                          | Run **InfiniAI: Add Provider Group**, read the guide, select **Open Language Models**, then choose **Add Models** > **InfiniAI**. Accept or edit the [Group Name](#provider-groups-and-group-name), then enter the API key. |
| Replace an API key                      | Open the action menu for the InfiniAI provider group and select **Update API Key**.                                                                                                                                         |
| Rename a provider group                 | Open the provider-group action menu and select **Rename Group**.                                                                                                                                                            |
| View the non-secret group configuration | Select **Open in Language Models (JSON)**. The API key remains secret and is not managed in that JSON file.                                                                                                                 |
| Remove an API key and group             | Select **Delete** from the provider-group action menu and confirm. VS Code removes the group and its stored secret.                                                                                                         |
| Fully reset a key                       | Delete the provider group, then use **Add Models** > **InfiniAI** to create it again.                                                                                                                                       |

There is no separate InfiniAI command to set, remove, sign out, or reset an API key. **InfiniAI: Open InfiniAI
Settings** opens ordinary `infiniai.*` settings and cannot display or modify provider-group secrets.

### Where to find InfiniAI

- The **InfiniAI** activity bar contains a **Models** tree for provider-group status, model refresh, provider filtering,
  guided provider-group setup, direct access to VS Code Manage Models, per-model Agent eligibility, and protocol
  switching.
- Its **Usage** view contains the **Local Usage** dashboard, records streamed request usage locally, and provides
  **Export CSV** and **Reset** actions. Resetting records requires confirmation.
- The `@infiniai` Chat participant provides diagnostics and connectivity tests. It is not a replacement chat assistant;
  see the [chat diagnostics reference](#chat-diagnostics).
- **Help: Get Started** > **Get Started with InfiniAI** reopens the provider-group and model-verification walkthrough.

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
  extension includes exact evidence-based fallbacks for models verified by API probes but not marked as tool-capable
  by the live catalog. It also advertises every `claude-*` model as Agent-capable by default. Prefer **InfiniAI:
  Configure Agent Eligibility** for exact IDs; use this setting directly for advanced wildcard patterns. An explicit
  live/catalog value remains authoritative unless this user setting overrides it. The Claude family default controls
  picker eligibility; it does not certify that every upstream InfiniAI Claude route is currently reachable.
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

Agent-eligible third-party InfiniAI models remain available to VS Code Agent experiences. Capability metadata and the
`infiniai.toolCallingModels` / `infiniai.disableToolCallingModels` overrides determine that eligibility; unknown models
are not marked Agent-capable by default. In VS Code 1.130 this path also requires the agent host and its default-on
`chat.agentHost.byokModels.enabled` bridge; changing either agent-host setting requires an agent-host restart.

Use **InfiniAI: Configure Agent Eligibility** from the Command Palette, the Models view toolbar, or a model's context
menu. Each exact model ID has three choices:

- **Automatic (Recommended)** uses live API metadata, extension defaults—including the `claude-*` family policy—and
  otherwise keeps unknown models out of Agent mode.
- **Enable for Agent** adds an exact user override after warning that metadata cannot create upstream tool support.
- **Disable for Agent** prevents the model from appearing in Agent model pickers.

The Models tree tooltip identifies the effective source as API metadata, extension metadata, user enabled, user
disabled, or unknown. Overrides apply to the model ID across all InfiniAI provider groups. The guided command does
not rewrite wildcard patterns because doing so could affect other models; edit wildcard settings directly when such a
pattern controls the selected ID. Configuration changes rebuild cached metadata and notify VS Code without refetching
the model catalog.

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
	"thinking": { "type": "disabled" },
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

## Common procedures

### Refresh model discovery and test connectivity

1. Run **InfiniAI: Refresh Models**. It cancels active discovery, invalidates the active discovery cache, and retries
   every resolved InfiniAI provider group in a cancellable progress notification. The last known-good model list remains
   available if that retry fails.
2. If refresh fails, choose **Manage Models** or **Open Logs** from the error notification.
3. Run `@infiniai /doctor` to check provider groups, the discovery endpoint, cache state, route overrides, and the last
   sanitized error.
4. Run `@infiniai /models refresh` to refresh and inspect the resulting model, route, and capability list.
5. Run `@infiniai /test` to choose a visible model and send a minimal cancellable request through its effective route.

### Include, exclude, or restore models

Model visibility has two layers. Use the **InfiniAI** activity bar's **Models** tree to control what the extension returns
to VS Code:

- Run **InfiniAI: Exclude InfiniAI Model from Provider List** or use the eye icon on an included model row.
- Run **InfiniAI: Include InfiniAI Model in Provider List** or use the eye icon on an excluded row. Including a model
  explicitly overrides a matching `infiniai.hiddenModelPatterns` entry.
- Run **InfiniAI: Reset InfiniAI Provider Model Filters** to clear explicit inclusions, exclusions, and hidden patterns.
  This is a show-all reset, so every discovered model becomes provider-visible. To restore the extension's packaged
  hidden-pattern defaults later, reset `infiniai.hiddenModelPatterns` itself in VS Code Settings.

Then use **InfiniAI: Open VS Code Manage Models** to control which provider-visible models appear in VS Code pickers.
Changing one layer does not change the other.

### Configure Agent eligibility

Run **InfiniAI: Configure Agent Eligibility** from the Command Palette, Models-view toolbar, or a model row. Choose
**Automatic** to follow API and extension metadata, **Enable for Agent** to assert support for one exact model ID, or
**Disable for Agent** to keep that ID out of Agent pickers. Enabling only changes advertised metadata; it cannot add
tool support to the upstream model. If a wildcard setting controls the ID, the command directs you to Settings rather
than silently changing a rule that may affect other models.

### Change a model's protocol

Run **InfiniAI: Switch Model Protocol** from the Command Palette or a Claude-compatible model row. Choose **OpenAI Chat
Completions** or **Anthropic Messages**. The command saves an exact global route override for that model. If one already
exists, choose **Reset exact override** to remove only that entry and return to any matching wildcard, catalog route, or
provider default. See [Routing And Protocol Switching](#routing-and-protocol-switching) for precedence and endpoint
behavior.

### Clear preserved thinking

Run **InfiniAI: Clear Thinking Replay Cache** to immediately clear the active memory or local-plaintext replay store.
This cannot be undone. Start a new chat afterward: a follow-up in an existing replay-required conversation may fail
locally because the extension will not send an unsafe request without the preserved provider-native thinking data.

### Review or remove local usage records

Open the **InfiniAI** activity bar and select **Usage**. Use **Export CSV** to save the locally recorded request usage,
or **Reset** and confirm to remove all local usage records.

## Command reference

Open the Command Palette and type `InfiniAI:` to find every extension command:

| Command Palette title                                   | Command ID                          | What it does                                                                                                                              |
| ------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **InfiniAI: Refresh Models**                            | `infiniai.refreshModels`            | Cancels active model discovery and explicitly retries all resolved provider groups with cancellable progress.                             |
| **InfiniAI: Exclude InfiniAI Model from Provider List** | `infiniai.hideModel`                | Prompts for an included model, or acts on the selected Models-tree row, and excludes that ID before models are returned to VS Code.       |
| **InfiniAI: Include InfiniAI Model in Provider List**   | `infiniai.showModel`                | Prompts for an excluded model, or acts on the selected Models-tree row, and force-includes that ID even when a hidden pattern matches it. |
| **InfiniAI: Reset InfiniAI Provider Model Filters**     | `infiniai.showAllModels`            | Clears `hiddenModels`, `hiddenModelPatterns`, and `visibleModels`, making every discovered model provider-visible.                        |
| **InfiniAI: Switch Model Protocol**                     | `infiniai.switchModelProtocol`      | Prompts for a Claude-compatible model and creates, changes, or resets its exact OpenAI/Anthropic route override.                          |
| **InfiniAI: Configure Agent Eligibility**               | `infiniai.configureAgentEligibility` | Sets an exact model ID to Automatic, Enable for Agent, or Disable for Agent while preserving wildcard settings.                         |
| **InfiniAI: Open InfiniAI Settings**                    | `infiniai.openSettings`             | Opens VS Code Settings filtered to `infiniai.*`. It does not manage API keys.                                                             |
| **InfiniAI: Add Provider Group**                        | `infiniai.addProviderGroup`         | Explains Group Name and safe naming choices, then opens VS Code's Language Models window after confirmation.                              |
| **InfiniAI: Open VS Code Manage Models**                | `infiniai.openManageModels`         | Opens VS Code's Language Models window for provider groups, secrets, model visibility, and per-model controls.                            |
| **InfiniAI: Open InfiniAI Logs**                        | `infiniai.openLogs`                 | Opens the `InfiniAI` output channel.                                                                                                      |
| **InfiniAI: Clear Thinking Replay Cache**               | `infiniai.clearThinkingReplayCache` | Clears the active preserved-thinking replay store. Start a new chat before continuing with a replay-required model.                       |

### Chat diagnostics

Enter these commands in VS Code Chat:

| Chat command                | What it does                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `@infiniai /doctor`         | Reports the VS Code version, provider groups, discovery endpoint and summary, cache age, route override counts, and last sanitized errors. |
| `@infiniai /models`         | Lists up to 50 cached models with provider group, effective transport, route source, tools, image input, and input/output token budgets.   |
| `@infiniai /models refresh` | Refreshes model discovery before producing the same model report.                                                                          |
| `@infiniai /test`           | Prompts for a visible model when needed and sends a minimal cancellable health request through its effective route.                        |

The `@infiniai` participant is diagnostic only; it does not answer general chat requests.

## Stable API Policy

The Marketplace manifest declares no `enabledApiProposals` and contains no proposed-API launch flags.

The provider uses stable VS Code contribution points plus a small, audited stable-gray surface that is accepted by current VS Code Stable builds:

- `isBYOK` exports Agent-eligible InfiniAI models to the Agents-window bridge.
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

### API Key Or Provider Group Needs Attention

1. Run **InfiniAI: Open VS Code Manage Models**.
2. Open the InfiniAI provider-group action menu and select **Update API Key** to replace the secret.
3. Run **InfiniAI: Refresh Models**, then `@infiniai /test`.
4. If the group itself is no longer usable, select **Delete**, confirm, and create it again through **Add Models** >
   **InfiniAI**.

Do not look for the key in **InfiniAI: Open InfiniAI Settings** or `settings.json`; VS Code owns provider-group
credentials. See [API key management](#api-key-management) for every supported operation.

### No Models Appear

Check these in order:

1. Run **InfiniAI: Add Provider Group** if no InfiniAI group exists. For an existing group, run **InfiniAI: Open VS
   Code Manage Models** and use **Update API Key** if its credential may be stale.
2. Run **InfiniAI: Refresh Models**. The operation is cancellable and a failure includes direct **Manage Models** and
   **Open Logs** remedies.
3. Run `@infiniai /doctor` and verify the provider-group count, discovery endpoint, cache state, and last error.
4. Clear `infiniai.modelDiscoveryUrl` unless you intentionally use a custom discovery endpoint.
5. Run **InfiniAI: Reset InfiniAI Provider Model Filters**, then check model visibility in VS Code's Language Models
   window. These are [independent visibility layers](#include-exclude-or-restore-models).
6. Run **InfiniAI: Open InfiniAI Logs** for the sanitized discovery error. Reload the window only if the provider group
   itself does not re-resolve.

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
