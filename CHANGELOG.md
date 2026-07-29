# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- InfiniAI authentication now uses one canonical `infiniai.apiKey` secret and one Accounts-menu session.
- Default model discovery and request routing now use the unified `/maas` endpoints. Explicit `modelDiscoveryUrl` and `modelRoutes[].baseUrl` overrides remain authoritative.
- Live model discovery now validates and deduplicates catalog rows, registers only chat-capable model types, applies provider-published context and output limits, and reports filtering diagnostics.
- The Marketplace minimum is now VS Code `^1.130.0`; development typings remain aligned to stable API version `1.125.0`.

### Removed

- Removed the public plan picker, plan tree node, dual-account UI, `infiniai.plan` and `infiniai.coding.*` settings, and the contributed `infiniai.switchPlan` command.

## [0.6.5] - 2026-06-17

### Added

- GLM-5.2 now has a dedicated OpenAI-compatible reasoning profile with model-picker `Reasoning effort` choices limited to `Unset`, `High`, and `Max`, default replay effort `max`, and built-in 1,000,000-token context metadata.

## [0.6.4] - 2026-06-03

### Fixed

- DeepSeek V4 OpenAI-compatible reasoning replay now treats compaction-generated tool-call turns without historical `reasoning_content` as best-effort instead of failing locally. Live probes confirmed `deepseek-v4-pro` and `deepseek-v4-flash` accept follow-up requests with the assistant tool call and tool result preserved while `reasoning_content` is omitted.
- Kimi K2 OpenAI-compatible reasoning replay now treats tool-call turns without historical `reasoning_content` as best-effort instead of failing locally. Live probes confirmed `kimi-k2.6` accepts follow-up requests with captured, omitted, and blank historical `reasoning_content` in non-streaming and streaming modes.

## [0.6.3] - 2026-06-02

### Added

- Confirmed Claude adaptive-thinking models on Anthropic Messages routes (`claude-opus-4-6`, `claude-opus-4-7`, and `claude-sonnet-4-6`) now expose thinking controls in the model picker and send the provider-native `thinking: { type: "adaptive", display: "summarized" }` request shape when thinking is enabled.
- `claude-sonnet-4-5-20250929` now uses the non-adaptive Anthropic extended-thinking request shape, sending `thinking: { type: "enabled", budget_tokens: ... }` when thinking is enabled.
- Anthropic thinking replay now captures and replays `redacted_thinking` blocks, so Claude tool-call conversations can preserve provider-required thinking continuity even when the provider redacts the visible thinking text.

### Fixed

- Anthropic Messages requests now send Bearer authorization in addition to Anthropic-compatible headers, matching InfiniAI endpoints that require `Authorization: Bearer ...`.
- Explicitly setting `Thinking mode` to `Disabled` no longer requires thinking replay preflight, so users can use disabled thinking as the intended escape hatch for conversations without preserved thinking context.
- Anthropic streaming usage tracking now reads usage from both `message_start.message.usage` and delta usage payloads.
- Claude adaptive-thinking tool-call turns that emit no `thinking` or `redacted_thinking` block are now recorded as observed no-payload turns, preventing false missing-replay failures on the next request.

## [0.6.2] - 2026-06-01

### Changed

- OpenAI-compatible DeepSeek V4 model picker reasoning effort is now limited to `Unset`, `High`, and `Max`; unsupported `low` and `medium` values are ignored for that profile.

## [0.6.1] - 2026-05-30

### Fixed

- VS Code model metadata now advertises practical prompt budgets instead of reserving each provider's full maximum completion window. This delays unnecessary Copilot Chat compaction for long-context models such as GLM 5.x, Kimi K2.6, DeepSeek V4, and MiMo while keeping a 16K interactive output reserve.

## [0.6.0] - 2026-05-29

### Fixed

- GLM thinking replay is now best-effort for compaction-generated tool-call turns that contain no reasoning text: captured `reasoning_content` is still replayed when available, but provider-accepted continuations are no longer blocked locally only because compaction produced a no-reasoning tool call.
- OpenAI-compatible streaming replay capture now also recognizes choice-level `reasoning_content` before tool calls.

## [0.5.9] - 2026-05-29

### Changed

- MiMo V2 defaults now prefer OpenAI-compatible Chat Completions, confirmed MiMo V2 model IDs expose reasoning effort and replay controls, and unprobed MiMo V2 variants remain safe-off.
- DeepSeek thinking replay is now transport-aware: `deepseek-r1` uses forced OpenAI `reasoning_content` replay, Anthropic `deepseek-v3.2` exposes Anthropic `thinking` plus `output_config.effort`, and forced `deepseek-v3.2-thinking` is included in the replay defaults without broadening the base `deepseek-v3.2` model.
- `infiniai.enableThinkingRoundTripForModels` now adds exact defaults for `deepseek-r1` and `deepseek-v3.2-thinking`, while leaving `deepseek-v3.2`, `deepseek-r1-distill-qwen-32b`, and `pro-deepseek-r1` out until separately verified.
- GLM built-in route defaults now align with OpenClaw's bundled Z.AI provider: GLM 4.5+, 4.6, 4.7, and 5.x models default to OpenAI-compatible Chat Completions instead of Anthropic Messages.
- Kimi K2 defaults now prefer OpenAI-compatible Chat Completions even when catalog metadata is Anthropic Messages, so preserved thinking uses the known `thinking.keep` plus `reasoning_content` shape by default.
- DeepSeek V4 defaults now prefer OpenAI-compatible Chat Completions even when catalog metadata is Anthropic Messages, avoiding the Anthropic thinking-plus-tools stream shape unless the user explicitly routes the model back.
- Manually routed Kimi Anthropic Messages requests now use a conservative safe-off profile: thinking defaults to `disabled`, no reasoning effort is exposed, and the model-id round-trip default is not applied to that transport.
- Anthropic-routed DeepSeek V4 requests now use a conservative safe-off profile: thinking defaults to `disabled`, no reasoning effort is exposed, and the `deepseek-v4*` round-trip default applies only to the OpenAI-compatible route.

### Fixed

- GLM thinking replay preservation now applies the provider-native `thinking.clear_thinking: false` control during round-trip requests and reports replay-miss context with model, transport, profile, carrier, and affected tool call IDs.
- Kimi tool schemas are sanitized before OpenAI-compatible and Anthropic Messages requests to avoid Moonshot-incompatible schema shapes such as nullable enums, tuple `items`, `$ref` siblings, and missing scalar `type` fields.
- DeepSeek V4 on the Anthropic Messages route no longer sends `thinking: enabled` by default on tool-call turns, avoiding provider streams that put `input_json_delta` on a `thinking` block instead of a valid `tool_use` block.
- Malformed Anthropic streams that send `input_json_delta` without an active `tool_use` block now fail with a clear protocol error instead of silently dropping tool arguments.

## [0.5.8] - 2026-05-19

### Fixed

- InfiniAI model hover text now includes the configurable model controls directly, so `Reasoning effort` and `Thinking mode` are visible before VS Code refreshes its own gated configuration-tag display.

## [0.5.7] - 2026-05-19

### Added

- Family-specific reasoning replay profiles for OpenAI-compatible GLM, Kimi, Qwen, MiMo V2, DeepSeek V4, MiniMax, and Anthropic Messages routes. Replay now follows the resolved model profile instead of assuming every family uses the same `reasoning_content` shape.
- Carrier-aware replay for MiniMax split mode: streamed `reasoning_details` are stored and replayed as `assistant.reasoning_details` instead of being collapsed into `reasoning_content`.
- Family-specific preservation controls for replayed thinking context: GLM uses `thinking.clear_thinking`, Kimi uses `thinking.keep`, and Qwen uses `preserve_thinking`.

### Changed

- MiniMax requests now always include `reasoning_split: true` so split-mode reasoning is requested consistently on OpenAI-compatible and Anthropic-routed paths.
- `infiniai.enableThinkingRoundTripForModels` now ships with verified replay-capable family defaults: `mimo-v2*`, `deepseek-v4*`, `glm-5*`, `glm-4.7*`, `kimi-k2*`, and `minimax*`. User patterns extend that list.
- README files now document the profile-based replay design, MiniMax `reasoning_split`, provider-native replay carriers, and the narrower model picker thinking controls.

## [0.5.6] - 2026-05-16

### Changed

- Thinking replay now works for Anthropic-routed MiMo/DeepSeek tool-call conversations, not only OpenAI-compatible routes. Anthropic streaming captures `thinking` blocks and optional signatures, then replays them before prior `tool_use` blocks when an opted-in model needs the previous reasoning context.
- README files now document the user flow for opting thinking models into replay and clarify that replay safety follows Claude-compatible models across OpenAI Chat Completions and Anthropic Messages protocol switching.

### Fixed

- Opted-in Claude-compatible thinking models such as `mimo-v2.5-pro` no longer bypass replay safety when routed through Anthropic Messages, avoiding the `reasoning_content` HTTP 400 seen after tool-call turns.

## [0.5.5] - 2026-05-16

### Added

- Stable-safe model picker controls for max output tokens, reasoning effort, and thinking mode. Unset/Empty values send no optional reasoning or thinking parameters; selected reasoning effort is sent on OpenAI-compatible routes only.
- `InfiniAI: Switch Model Protocol` command and InfiniAI Models tree context action for Claude-compatible models. The UI writes exact per-model `infiniai.modelRoutes` overrides for OpenAI Chat Completions or Anthropic Messages, and can reset the exact override.
- Generated built-in InfiniAI catalog metadata for richer model families, context windows, route defaults, chat/non-chat filtering, and capability hints. Regenerate it from the static `reports/list-models.json` snapshot with `npm run catalog:normalize`.

### Changed

- The Models tree tooltip now shows effective transport, route source, endpoint kind, picker visibility, and core capabilities.
- `@infiniai /models` includes the route source column, and `@infiniai /doctor` reports total configured route overrides plus exact per-model route overrides.
- `@infiniai /test` now chooses only from visible InfiniAI models in the provider cache and no longer requires tool-calling capability for a simple health request.
- The README files now document the stable-gray API policy used for `isUserSelectable`, `configurationSchema`, and model configuration request options while keeping the Marketplace manifest free of proposed API declarations.
- Detailed proposed-API compatibility guidance for thinking replay now lives in `reports/infiniai-thinking-replay-store-design-report.md`, keeping the README files focused on user-facing behavior.

### Fixed

- The Local Usage dashboard reset action now uses a native VS Code confirmation dialog and reliably clears locally recorded usage data after confirmation.
- Protocol switching deduplicates exact per-model route entries, places exact overrides before broader wildcard matches, and drops stale `baseUrl` values when changing transport through the UI.

## [0.5.4] - 2026-05-15

### Added

- Extension-owned `reasoning_content` replay for explicitly opted-in thinking models. Configure `infiniai.enableThinkingRoundTripForModels` with model ID patterns such as `mimo-v2*` or `deepseek-v4*` to let the extension capture and replay structured reasoning for tool-call conversations.
- `infiniai.thinkingReplayStore` for replay storage selection:
  - `"localPlaintext"` is the default and stores replay data in a local plaintext extension-storage file so opted-in thinking tool-call conversations can continue after VS Code reload or restart while cache entries remain valid.
  - `"memory"` keeps replay data process-local and writes no replay cache file, but cannot resume thinking tool-call conversations after VS Code reload or restart.
- `InfiniAI: Clear Thinking Replay Cache` command for removing the active replay cache.

### Changed

- `infiniai.disableThinkingForModels` is now additive: built-in safety defaults for known MiMo V2 and DeepSeek V4 thinking models always remain active, while user patterns extend the list.
- `infiniai.enableThinkingRoundTripForModels` is now documented and implemented as an experimental, best-effort, heuristic opt-in layered on top of `infiniai.disableThinkingForModels`. If a model matches both settings, the opt-in keeps thinking enabled only when replay preflight proves the required `reasoning_content` is available; otherwise the extension fails locally instead of sending a request that would trigger HTTP 400.
- Removed `enabledApiProposals` from the Marketplace manifest. The optional `LanguageModelThinkingPart` runtime detector remains only for development/custom-host compatibility; replay correctness and HTTP 400 mitigation no longer depend on proposed APIs.

### Fixed

- Opted-in MiMo V2 and DeepSeek V4 tool-call conversations now replay required `reasoning_content` before the next OpenAI-compatible request. If replay data is missing, expired, conflicting, or unavailable, the extension fails locally instead of sending an unsafe request that would trigger upstream HTTP 400.
- Affected models still force-disable thinking by default when not explicitly opted in, preserving the safe out-of-the-box behavior on VS Code Stable and Insiders.

## [0.5.3] - 2026-05-13

### Fixed

- `/test` now probes the first visible chat-capable InfiniAI model instead of the first raw discovered model. This avoids sending chat-completions probes to image/video generation models such as `stable-diffusion-1.5`, which can return HTTP 500 from the upstream API.

## [0.5.2] - 2026-05-13

### Added

- Provider-level model visibility controls. The InfiniAI Models view now lets users hide or show individual InfiniAI models. Hidden models are filtered out before the extension reports models to VS Code, while remaining visible in the InfiniAI Models view for later re-enabling.
- `infiniai.hiddenModelPatterns` setting with default provider-level filters for image / video generation model families: `*vidu*`, `*seedream*`, `*seedance*`, `*image*`, `*diffusion*`, `*hailuo*`, and `*kling*`. `infiniai.hiddenModels` stores exact hidden model IDs, and `infiniai.visibleModels` stores exact IDs that should override the hidden pattern list.

### Fixed

- InfiniAI models now report `isUserSelectable: true` in `provideLanguageModelChatInformation`, ensuring they are included in VS Code's chat model picker by default on hosts that honor this proposed metadata field.

### Known upstream behavior (VS Code Insiders)

- VS Code **Insiders 1.120.0** (`0958016b2af9f09bb4257e0df4a95e2f90590f9f`) no longer shows the eye / eye-closed model visibility controls in the Manage Models editor. This is an upstream VS Code change from microsoft/vscode#314598 ("Remove visibility controls for models in the model configuration window"), not an InfiniAI extension regression.
- **Mitigation in 0.5.2**: setting `isUserSelectable: true` keeps eligible InfiniAI models visible in the model picker by default, while the provider-level visibility controls above replace the removed VS Code per-model show / hide UI for InfiniAI models.

## [0.5.1] - 2026-05-13

### Added

- `infiniai.disableThinkingForModels` setting (string-array glob, supports `*` wildcards). Defaults to `mimo-v2-pro`, `mimo-v2.5-pro`, `mimo-v2.5`, `mimo-v2-omni`, `mimo-v2-flash`, `deepseek-v4*` (#17).
- README "Thinking mode" section (English + Chinese) explaining the upstream `reasoning_content` echo-back requirement, why the stable VS Code language-model API cannot satisfy it, the trade-off, and how to override (#17).
- Manifest now declares `enabledApiProposals: ["languageModelThinkingPart"]`. The extension performs a runtime capability check (`src/proposedApi.ts`) and, when the host actually exposes `vscode.LanguageModelThinkingPart` (VS Code Insiders launched with `--enable-proposed-api drewzhao.infiniai-copilot`), automatically: (1) streams reasoning chunks as `LanguageModelThinkingPart` parts so the chat UI preserves them across turns, (2) echoes `reasoning_content` back to MiMo V2 / DeepSeek V4 on subsequent turns to avoid the HTTP 400, and (3) skips the force-disable injection. Stable VS Code transparently falls back to the previous force-disable behavior. README + Chinese README updated with Insiders opt-in instructions.

### Fixed

- HTTP 400 `reasoning_content is required when the previous assistant message contains tool calls` against known Xiaomi MiMo V2 model IDs and the DeepSeek V4 family on the second turn of a tool-call loop. The OpenAI-compatible request body now injects both `enable_thinking: false` and `thinking: { type: "disabled" }` for matching models (#17).

## [0.5.0] - 2026-05-12

### Added

- `withProgress` notification while the provider fetches and caches models on cache-miss, so users see feedback during the first chat after activation (#3).
- Localized manifest (`package.nls.json`, `package.nls.zh-cn.json`) and runtime strings via `vscode.l10n` with a `l10n/` bundle directory; English fallback + Simplified Chinese translation included (#5).
- `InfiniAIAuthenticationProvider` registered with `vscode.authentication`, surfacing Standard and Coding plan API keys in the Accounts menu, with sign-in / sign-out wired through a shared persistence path (#6).
- New `InfiniAI` activity bar container with a Models tree view (`infiniai.modelsView`) showing discovered models, route metadata, and a refresh action (#8a).
- Local Usage dashboard webview (`infiniai.usageView`) inside the activity bar that visualizes recent chat usage events and supports exporting the data (#9a).
- Actionable error toasts: chat-response failures are classified (auth / quota / rate-limit / network / model-not-found / server) and surfaced via `vscode.window.showErrorMessage` with one-click recovery buttons — Set/Get API Key, Open Dashboard, Switch Plan, Refresh Models, Open Settings (#11).
- `src/ui/quickPick.ts` with reusable `pickPlan()` and `pickAccountToSignOut()` helpers built on `window.createQuickPick` (separators, gear buttons, current-plan check icon, focus-out persistence) (#12).
- Copilot Chat dependency check: a one-time `showInformationMessage` prompts to install `github.copilot-chat` when missing, with a 7-day snooze persisted in `globalState` and re-evaluation on `vscode.extensions.onDidChange` (#14).
- LanguageStatusItem (`infiniai.model`) showing the most recently used model and `used / max tokens (transport)`; severity escalates to Warning at ≥90% context-window utilization (#15).
- Declared `extensionKind: ["ui", "workspace"]`, `capabilities.virtualWorkspaces`, and untrusted-workspace support so the extension can surface in remote / virtual / web hosts (#16).

### Changed

- `extension.ts` plan / sign-out flows route through the new QuickPick helpers instead of inline `showQuickPick` calls (#12).
- `copilotChatDependency` branches on `vscode.env.uiKind`: on `UIKind.Web` the install action opens the Marketplace listing via `env.openExternal` instead of invoking the desktop-only `workbench.extensions.installExtension` command (#16).
- The chat-response catch path now additionally surfaces a categorized toast while still re-throwing so VS Code's inline chat error rendering is preserved (#11).

## [0.4.0] - 2026-04-27

### Added

- Added stable `@infiniai` chat participant commands: `/doctor`, `/models`, `/models refresh`, and `/test`.
- Added provider-owned model discovery cache with TTL, in-flight request dedupe, route metadata, last-good fallback, and invalidation on configuration or secret changes.
- Added configurable `infiniai.modelDiscoveryUrl`, `infiniai.modelCacheTtlMs`, and `infiniai.modelRoutes`.
- Added metadata-driven OpenAI, Anthropic, and Vertex route resolution.
- Added a shared cancellation-aware SSE reader that handles split chunks, CRLF, multiline `data:` events, `[DONE]`, and final buffer flushing.
- Added typed provider errors and redacted `LogOutputChannel` logging.

### Changed

- Raised the VS Code engine target to `^1.117.0`.
- Removed the hard dependency on the standalone `github.copilot-chat` extension.
- Switched to npm-only dependency management and removed the pnpm lockfile.
- Kept activation lazy by relying on stable provider and participant contribution activation.
- Routed Anthropic requests to `/v1/messages` and Vertex requests to `:streamGenerateContent` when route metadata selects those transports.
- Made retry, delay, streaming, model discovery, and health checks cancellation-aware.

### Fixed

- Fixed retry configuration to read `infiniai.retry`.
- Fixed language model provider disposal by registering provider resources in `context.subscriptions`.
- Fixed status bar command wiring to invoke `infiniai.setApikey`.
- Removed proposed API `.d.ts` remnants and proposed API launch flags.
- Prevented malformed streaming JSON and provider protocol errors from being silently swallowed.

### Tests

- Added coverage for retry attempt semantics, route resolution, and SSE final-buffer/multiline parsing.
- Verified compile, lint, unit tests, and VSIX build for the modernization release.

## [0.2.1] - 2026-03-09

### Changed

- Migrated from proposed VS Code APIs to stable marketplace APIs.
- Removed `enabledApiProposals` from `package.json` (was `["chatProvider", "languageModelThinkingPart"]`).
- Removed `LanguageModelThinkingPart` usage; thinking content is now tracked internally without emitting response parts.
- Simplified thinking buffer management by removing flush timers and delayed reporting.

### Fixed

- Updated type definitions to use stable `vscode.LanguageModelResponsePart` instead of proposed `LanguageModelResponsePart2`.

## [0.2.0] - 2026-02-13

### Added

- Smarter image input capability detection using model metadata (e.g. `vision`, `architecture.input_modalities`) with a heuristic fallback.
- User overrides for image input capability:
  - `infiniai.imageInputModels` to force-enable image input by model ID pattern (supports `*` wildcard).
  - `infiniai.disableImageInputModels` to force-disable image input by model ID pattern (supports `*` wildcard).
- First-time plan selection prompt when the extension needs to ask for an API key interactively (Standard vs Coding), with the choice persisted to `infiniai.plan`.
- Mocha unit tests for plan selection and image capability resolution (`npm test`).

### Changed

- `infiniai.plan` no longer declares a manifest default; the extension treats unset as `standard` for routing and prompts for plan selection during interactive API key entry.
- `npm test` now runs `tsc` + Mocha unit tests (instead of `vscode-test`).
