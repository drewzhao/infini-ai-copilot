# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

