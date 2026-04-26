# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
