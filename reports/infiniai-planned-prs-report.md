# InfiniAI Planned PRs Report

Date: 2026-05-16

## Purpose

This report is the standing tracker for planned InfiniAI VS Code extension PRs after the VS Code Stable language-model provider investigation.

Use it to answer:

- What PR should we do next?
- Which changes are safe for Marketplace Stable?
- Which changes depend on gray VS Code runtime surfaces?
- What acceptance tests must pass before a PR is mergeable?
- Which items are deferred because they would require proposed API usage or fake Agents-window compatibility?

## Current Repo Snapshot

- Repo path: `/Users/zhaoyinghao/code/github/infini-ai-copilot`
- Current branch at report creation: `infini-ai-copilot`
- Tracking branch: `origin/infini-ai-copilot`
- Working tree at report creation: clean
- Current stable target observed locally: VS Code `1.120.0`

Relevant current facts:

- `package.json` contributes `languageModelChatProviders` with vendor `infiniai`.
- `package.json` still uses deprecated `managementCommand: "infiniai.setApikey"`.
- `package.json` does not declare `enabledApiProposals`.
- `src/extension.ts` registers authentication provider `infiniai`, but `package.json` does not currently declare `contributes.authentication`.
- `src/provider.ts` sets `isUserSelectable: true` by casting the returned model info to `LanguageModelChatInformation`.
- `src/provider.ts` logs hidden `requestInitiator`.
- `configurationSchema`, picker `category`, `statusIcon`, and pricing metadata are not yet used.
- Request builders do not yet consume `options.modelConfiguration` / `options.configuration` as a first-class per-model config path.

## Guardrail Standard

All PRs in this plan must preserve the Stable/Marketplace policy:

```text
Do not add package.json#enabledApiProposals.
Do not require --enable-proposed-api.
Do not rely on Extension Development Host-only proposal access.
Do not trigger checkProposedApiEnabled at runtime.
```

Classification standard:

| Label | Meaning | Merge posture |
|---|---|---|
| Stable public API | Declared in stable `vscode.d.ts` or stable contribution schema. | OK. |
| Safe gray surface | Runtime-accepted in VS Code Stable without proposal declaration. | OK with guards and tests. |
| Hidden inbound option | Runtime option passed by VS Code Stable without proposal declaration. | OK when optional and tested. |
| Experimental runtime export | Runtime object exists but stable d.ts does not declare it. | Optional only. |
| Proposal-gated | Requires `enabledApiProposals`, `--enable-proposed-api`, or proposal enablement. | Do not ship. |
| Trap | Appears useful but misrepresents support or routes through the wrong backend. | Avoid. |

## Status Legend

| Status | Meaning |
|---|---|
| Proposed | Planned but not started. |
| Ready | Scope is clear enough to implement. |
| In progress | Work has started on a branch. |
| Blocked | Needs external information, product decision, or upstream behavior. |
| Done | Merged and verified. |
| Deferred | Intentionally postponed. |

## PR Board

| ID | Proposed PR | Status | Risk | Depends on | Primary outcome |
|---|---|---|---|---|---|
| PR-001 | Stable guardrails and auth manifest fix | Done | Low | None | Remove manifest warning and enforce no proposed API declaration. |
| PR-002 | Gray metadata helper and model picker UX | Done | Low/Medium | PR-001 | Centralize gray fields and improve picker metadata. |
| PR-003 | Per-model configuration schema and request mapping | Done | Medium | PR-001, PR-002 preferred | Add user-visible per-model controls and map them safely to upstream requests. |
| PR-004 | Stable smoke/probe validation harness | Done | Medium | PR-001 | Make loophole usability testable in Stable without proposal flags. |
| PR-005 | Provider-group configuration migration study | Deferred | Medium/High | PR-003, UX decision | Decide whether to replace or supplement `managementCommand`. |
| PR-006 | Agents-window compatibility strategy | Deferred | High | Upstream API clarity | Avoid fake support; document real options. |

## PR-001: Stable Guardrails And Auth Manifest Fix

Status: Done

### Goal

Make the extension cleaner in Stable before adding more gray-surface behavior.

### Scope

- Add `contributes.authentication` for provider id `infiniai`.
- Add an automated test or validation script that fails if `package.json` declares `enabledApiProposals`.
- Add an automated test or validation script that fails if known proposal-gated fields are introduced into shipped model metadata.
- Keep existing `managementCommand` behavior unchanged for this PR.
- Keep `isUserSelectable: true` unchanged.

### Candidate Files

- `package.json`
- `src/extension.ts`
- test files under `src` or a new lightweight validation test
- `package.nls.json`
- `package.nls.zh-cn.json`

### Acceptance Criteria

- No auth-provider manifest warning for `infiniai`.
- `package.json` has no `enabledApiProposals`.
- Tests fail if `enabledApiProposals` is added.
- Tests fail if shipped provider metadata includes hard-gated fields such as `capabilities.editTools`.
- Extension still activates and registers the language model provider.

### Suggested Verification

```bash
npm test
npm run compile
rg -n '"enabledApiProposals"|enableProposedApi' package.json src
```

Manual VS Code check:

- Launch Extension Development Host.
- Run `@infiniai /doctor`.
- Open logs and verify the previous authentication-provider warning is gone.

### Implementation Record

Implemented on 2026-05-16.

Files changed:

- `package.json`
- `src/stableApiGuardrails.test.ts`
- `reports/infiniai-planned-prs-report.md`

Verification:

- `npm run compile` passed.
- `npm test` passed with 70 passing tests.
- `npm run lint` passed.
- `rg -n '"enabledApiProposals"|enableProposedApi' package.json src` returned no matches.
- `rg -n 'targetChatSessionType|requiresAuthorization|isDefault|editTools|"enabledApiProposals"|enableProposedApi' package.json src --glob '!*.test.ts'` returned no matches.
- Extension Development Host launched in VS Code 1.120.0.
- Computer Use verified the InfiniAI view activated and listed models.
- Computer Use ran `@infiniai /doctor`; it reported VS Code 1.120.0, plan `standard`, 92 cached models, and no recent errors.
- Latest VS Code session logs under `~/Library/Application Support/Code/logs/20260516T030725` contained no `Undeclared authentication provider`, `CANNOT use API proposal`, `checkProposedApiEnabled`, `enabledApiProposals`, or `enableProposedApi` matches.

## PR-002: Gray Metadata Helper And Model Picker UX

Status: Done

### Goal

Centralize all Stable-safe gray metadata fields and use only low-risk picker improvements.

### Scope

- Add a helper such as `src/grayLanguageModelMetadata.ts`.
- Keep casts to gray fields centralized in that helper.
- Continue setting `isUserSelectable: true`.
- Optionally add `category: { label: "InfiniAI", order: ... }`.
- Optionally add `statusIcon` only for real provider/model state.
- Add pricing fields only if reliable InfiniAI pricing data exists.
- Explicitly do not add `targetChatSessionType`, `isDefault`, `requiresAuthorization`, or `capabilities.editTools`.

### Candidate Files

- `src/provider.ts`
- new helper file, likely `src/grayLanguageModelMetadata.ts`
- metadata unit tests

### Acceptance Criteria

- Gray metadata is built in one helper.
- `isUserSelectable` remains present for VS Code `1.120.0` compatibility.
- No proposal-gated field is emitted.
- Model picker still shows InfiniAI models in normal chat.
- No `CANNOT use API proposal` error appears in logs.

### Suggested Verification

```bash
npm test
npm run compile
rg -n 'targetChatSessionType|requiresAuthorization|isDefault|editTools|enabledApiProposals' package.json src
```

Stable UI check:

- Open the model picker.
- Verify InfiniAI models still appear.
- Verify category/status/cost metadata only if that PR intentionally adds them.

### Implementation Record

Implemented on 2026-05-16.

Files changed:

- `src/grayLanguageModelMetadata.ts`
- `src/grayLanguageModelMetadata.test.ts`
- `src/provider.ts`
- `reports/infiniai-planned-prs-report.md`

Notes:

- Added a small helper that centralizes Stable-safe gray model metadata.
- Moved `isUserSelectable: true` out of `src/provider.ts` and into the helper.
- Kept `statusIcon` in the helper type, but did not emit a status icon yet because the extension does not currently have a real per-model health/status signal.
- Did not add category, pricing, or configuration metadata in this PR; those need either reliable product data or the PR-003 request-mapping work.
- Did not add `targetChatSessionType`, `requiresAuthorization`, `isDefault`, or `capabilities.editTools`.

Verification:

- `npm test` passed with 73 passing tests.
- `npm run lint` passed.
- `rg -n '"enabledApiProposals"|enableProposedApi' package.json src` returned no matches.
- `rg -n 'targetChatSessionType|requiresAuthorization|isDefault|editTools|"enabledApiProposals"|enableProposedApi' package.json src --glob '!*.test.ts'` returned no matches.
- `rg -n 'isUserSelectable|statusIcon' src --glob '!*.test.ts'` only reported `src/grayLanguageModelMetadata.ts`.
- Computer Use reloaded the Extension Development Host and verified the InfiniAI view repopulated with models.
- Computer Use opened the model picker, searched `qwen3`, and verified InfiniAI Qwen models appeared in the picker.
- Latest VS Code session logs under `~/Library/Application Support/Code/logs/20260516T030725` contained no `Undeclared authentication provider`, `CANNOT use API proposal`, `checkProposedApiEnabled`, `enabledApiProposals`, `enableProposedApi`, `targetChatSessionType`, `requiresAuthorization`, or `editTools` matches.

## PR-003: Per-Model Configuration Schema And Request Mapping

Status: Done

### Goal

Use VS Code Stable's runtime-accepted `configurationSchema` and hidden request configuration options to provide real per-model controls without declaring proposed APIs.

This is the highest-value feature PR after guardrails.

### Scope

- Add `configurationSchema` for selected model controls.
- Read both possible runtime option names defensively:
  - `options.modelConfiguration`
  - `options.configuration`
- Map supported config keys to OpenAI-compatible, Anthropic-compatible, and Vertex-compatible request fields.
- Ignore unknown keys by default.
- Do not log secrets or raw config values that may contain credentials.
- Keep existing workspace settings as fallback or global defaults.

### Candidate Controls

Start small:

| Control | Example values | Target mapping |
|---|---|---|
| Reasoning effort | `low`, `medium`, `high` | OpenAI-compatible `reasoning_effort` when supported. |
| Max output tokens | numeric enum or bounded number | Provider-specific max output token field. |
| Thinking mode | `default`, `disabled`, `enabled` | Only for models where existing thinking replay rules allow it. |

Avoid in v1:

- Arbitrary raw request JSON passthrough.
- Secret-bearing per-model config.
- Provider-specific fields that cannot be validated.

### Candidate Files

- `src/provider.ts`
- `src/openai/openaiApi.ts`
- `src/anthropic/anthropicApi.ts`
- `src/vertex/vertexApi.ts`
- `src/types.ts`
- request-body tests

### Acceptance Criteria

- Stable model info includes `configurationSchema` only through the gray metadata helper.
- Request builders consume resolved per-model config.
- Config defaults work when the user has not overridden a value.
- Unit tests prove each supported config key maps to the correct request field.
- Unknown keys are ignored.
- No proposed API declaration is added.

### Suggested Verification

```bash
npm test
npm run compile
rg -n '"enabledApiProposals"|enableProposedApi' package.json src
```

Manual VS Code check:

- Open model picker.
- Confirm model configuration actions appear.
- Change one model config value.
- Send a request.
- Verify the request body contains the intended provider parameter and no unintended raw config.

### Implementation Record

Implemented on 2026-05-16.

Files changed:

- `src/modelConfiguration.ts`
- `src/modelConfiguration.test.ts`
- `src/grayLanguageModelMetadata.ts`
- `src/grayLanguageModelMetadata.test.ts`
- `src/provider.ts`
- `src/openai/openaiApi.ts`
- `src/anthropic/anthropicApi.ts`
- `src/vertex/vertexApi.ts`
- `reports/infiniai-planned-prs-report.md`

Notes:

- Added per-model configuration schema generation for max output tokens on all chat models.
- Added reasoning effort and thinking-mode controls only when built-in or live metadata marks the model as reasoning-capable.
- Kept the gray `configurationSchema` field centralized in `src/grayLanguageModelMetadata.ts`.
- Read both hidden runtime option names, `modelConfiguration` and `configuration`, with `modelConfiguration` taking precedence.
- Mapped supported keys only:
  - OpenAI-compatible: `maxOutputTokens` -> `max_tokens`, `reasoningEffort` -> `reasoning_effort`, `thinkingMode: "disabled"` -> `enable_thinking: false` and `thinking.type: "disabled"`.
  - Anthropic-compatible: `maxOutputTokens` -> `max_tokens`.
  - Vertex-compatible: `maxOutputTokens` -> `generationConfig.maxOutputTokens`.
- Ignored unknown keys and model-default values rather than passing raw configuration into request bodies.
- Did not add `enabledApiProposals`, `--enable-proposed-api`, raw request JSON passthrough, secret-bearing config, or `thinkingMode: "enabled"`.

Verification:

- `npm test` passed with 82 passing tests.
- `npm run lint` passed.
- `rg -n '"enabledApiProposals"|enableProposedApi' package.json src` returned no matches.
- `rg -n 'targetChatSessionType|requiresAuthorization|isDefault|editTools|"enabledApiProposals"|enableProposedApi' package.json src --glob '!*.test.ts'` returned no matches.
- `rg -n 'isUserSelectable|statusIcon|configurationSchema' src --glob '!*.test.ts'` only reported `src/grayLanguageModelMetadata.ts`.
- Computer Use reloaded the Extension Development Host.
- Computer Use opened the chat model picker, searched `qwen3`, and verified reasoning-capable InfiniAI Qwen models displayed `Model default` from the new configuration schema.
- Request-body mappings were verified by unit tests instead of UI request logging, so no raw request body or secret-bearing data needed to be logged.
- Latest VS Code session logs under `~/Library/Application Support/Code/logs/20260516T030725` contained no `Undeclared authentication provider`, `CANNOT use API proposal`, `checkProposedApiEnabled`, `enabledApiProposals`, `enableProposedApi`, `targetChatSessionType`, `requiresAuthorization`, `editTools`, or `configurationSchema` error matches.

## PR-004: Stable Smoke/Probe Validation Harness

Status: Done

### Goal

Make gray-surface usability repeatable instead of relying on memory or manual UI inspection.

### Scope Options

Option A: Lightweight validation script.

- Check `package.json` for no `enabledApiProposals`.
- Check compiled output or source for proposal-gated fields.
- Check installed VS Code Stable bundle for expected bridge/consumer strings.

Option B: Temporary probe extension.

- Register a tiny language model provider in a controlled extension host.
- Emit one test model per candidate gray field.
- Verify picker and request behavior manually or through UI automation.

Option C: Manual Stable smoke checklist.

- Package VSIX.
- Install into clean profile.
- Verify logs and model picker.

### Candidate Files

- `scripts/validate-stable-gray-surfaces.mjs`
- `reports/infiniai-planned-prs-report.md`
- test documentation under `reports/` or `docs/`

### Acceptance Criteria

- We can answer "does this gray surface still work in current Stable?" with a repeatable command/checklist.
- Validation fails if proposal flags are required.
- Validation distinguishes:
  - safe gray surface
  - proposal-gated
  - copied but inert
  - trap

### Suggested Verification

```bash
node scripts/validate-stable-gray-surfaces.mjs
code --version
```

Manual smoke command shape:

```bash
code \
  --user-data-dir /tmp/infiniai-vscode-smoke-user-data \
  --extensions-dir /tmp/infiniai-vscode-smoke-extensions \
  --extensionDevelopmentPath /Users/zhaoyinghao/code/github/infini-ai-copilot \
  /Users/zhaoyinghao/code/github/infini-ai-copilot
```

The command must not include `--enable-proposed-api`.

### Implementation Record

Implemented on 2026-05-16.

Files changed:

- `scripts/validate-stable-gray-surfaces.mjs`
- `package.json`
- `reports/infiniai-planned-prs-report.md`

Notes:

- Added `npm run validate:stable-gray`.
- The validator checks:
  - `package.json` has no `enabledApiProposals` or `enableProposedApi`.
  - Runtime source excludes hard-gated metadata fields.
  - Stable-safe gray metadata writes remain centralized in `src/grayLanguageModelMetadata.ts`.
  - The installed VS Code Stable bundle contains the expected gray bridge strings.
  - The local VS Code source tree, when present, still contains the expected bridge and gating patterns.
- The validator prints an explicit candidate classification:
  - safe gray surface: `isUserSelectable`, `statusIcon`, `configurationSchema`, `modelConfiguration`
  - proposal-gated: `capabilities.editTools`, `requiresAuthorization`, `isDefault`
  - trap / avoid: `targetChatSessionType` for Agents-window compatibility
  - copied but inert unless wired: unknown model configuration keys

Verification:

- `npm run validate:stable-gray` passed against `/Applications/Visual Studio Code.app` version 1.120.0 and `/Users/zhaoyinghao/code/github/vscode`.
- `npm test` passed with 82 passing tests.
- `npm run lint` passed.
- `rg -n '"enabledApiProposals"|enableProposedApi' package.json src` returned no matches.
- `rg -n 'targetChatSessionType|requiresAuthorization|isDefault|editTools|"enabledApiProposals"|enableProposedApi' package.json src --glob '!*.test.ts'` returned no matches.
- Computer Use verified the Extension Development Host still had InfiniAI loaded, models visible, and status bar `Ready`.
- Latest VS Code session logs under `~/Library/Application Support/Code/logs/20260516T030725` contained no `Undeclared authentication provider`, `CANNOT use API proposal`, `checkProposedApiEnabled`, `enabledApiProposals`, `enableProposedApi`, `targetChatSessionType`, `requiresAuthorization`, or `editTools` matches.

## PR-005: Provider-Group Configuration Migration Study

Status: Deferred

### Goal

Evaluate whether VS Code's `languageModelChatProviders.configuration` should replace or supplement the current `managementCommand` API-key flow.

### Why Deferred

This may change user setup UX and secret handling. It should not block safer metadata/config work.

### Scope

- Inspect VS Code Stable contribution schema for provider `configuration`.
- Prototype provider-group config in a branch.
- Confirm secret fields are stored in VS Code secret storage.
- Compare UX against current `infiniai.setApikey`.
- Decide whether to keep both paths during migration.

### Acceptance Criteria

- No regression to existing API-key setup.
- Secrets are not stored in plain settings.
- Existing users do not lose configuration.
- The migration has a rollback path.

## PR-006: Agents-Window Compatibility Strategy

Status: Deferred

### Goal

Document and test the real path for Agents-window compatibility without faking support through `targetChatSessionType`.

### Current Position

Do not ship `targetChatSessionType` as an Agents-window support mechanism.

Reason:

- It can affect model picker filtering.
- It does not prove the built-in Agents backend will send requests through our provider.
- It risks making InfiniAI appear supported in a flow where requests are handled by another backend.

### Scope

- Track upstream VS Code Stable APIs for Agents windows.
- Test any future official extension point or provider configuration.
- Consider tool/MCP integration as a separate path for agentic workflows.

### Acceptance Criteria

- No UI claims Agents-window support unless InfiniAI receives and handles the actual requests.
- No PR merges `targetChatSessionType` for built-in Agents windows without live Stable proof.
- A future Agents strategy has clear user-facing wording and fallback behavior.

## Recommended Execution Order

1. PR-001: Stable guardrails and auth manifest fix.
2. PR-002: Gray metadata helper and picker UX.
3. PR-003: Per-model configuration schema and request mapping.
4. PR-004: Stable smoke/probe validation harness.
5. PR-005: Provider-group configuration migration study.
6. PR-006: Agents-window compatibility strategy.

## Update Rules

Update this report whenever:

- A planned PR starts, blocks, lands, or is cancelled.
- VS Code Stable updates.
- A gray surface changes classification.
- A PR adds, removes, or changes a guardrail.
- Tests prove a surface is no longer usable in Stable.

When updating, change:

- PR board status.
- Acceptance criteria if scope changes.
- Verification commands if the test path changes.
- Current repo snapshot if branch/version context matters.

## Next Immediate Action

Start PR-001.

It is low risk, removes a real manifest warning, and creates the safety rails needed before we deliberately use more gray VS Code runtime surfaces.
