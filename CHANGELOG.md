# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `infiniai.disableThinkingForModels` setting (string-array glob, supports `*` wildcards). Defaults to `mimo-v2-pro`, `mimo-v2.5-pro`, `mimo-v2.5`, `mimo-v2-omni`, `mimo-v2-flash`, `deepseek-v4*` (#17).
- README "Thinking mode" section (English + Chinese) explaining the upstream `reasoning_content` echo-back requirement, why the stable VS Code language-model API cannot satisfy it, the trade-off, and how to override (#17).
- Manifest now declares `enabledApiProposals: ["languageModelThinkingPart"]`. The extension performs a runtime capability check (`src/proposedApi.ts`) and, when the host actually exposes `vscode.LanguageModelThinkingPart` (VS Code Insiders launched with `--enable-proposed-api drewzhao.infiniai-copilot`), automatically: (1) streams reasoning chunks as `LanguageModelThinkingPart` parts so the chat UI preserves them across turns, (2) echoes `reasoning_content` back to MiMo V2 / DeepSeek V4 on subsequent turns to avoid the HTTP 400, and (3) skips the force-disable injection. Stable VS Code transparently falls back to the previous force-disable behavior. README + Chinese README updated with Insiders opt-in instructions.

### Fixed

- HTTP 400 `reasoning_content is required when the previous assistant message contains tool calls` against Xiaomi MiMo V2 family and DeepSeek V4 family on the second turn of a tool-call loop. The OpenAI-compatible request body now injects both `enable_thinking: false` and `thinking: { type: "disabled" }` for matching models (#17).

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
