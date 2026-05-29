# InfiniAI MiMo Processing Refactor Report

Date: 2026-05-29

## Purpose

This report records what we know about improving the extension's handling of Xiaomi MiMo models, which parts are safe to implement now, which parts need live probe evidence, and the final implementation guidance after those probes run.

## Current Extension Behavior

The current InfiniAI catalog metadata marks the visible MiMo models as Anthropic Messages:

- `mimo-v2-pro`
- `mimo-v2.5-pro`

The route resolver currently overrides Kimi K2 to OpenAI-compatible Chat Completions, but does not do the same for MiMo. That means MiMo follows catalog `apiMode: "anthropic"` by default even though OpenClaw and Hermes both treat Xiaomi MiMo's primary route as OpenAI-compatible Chat Completions.

The OpenAI reasoning profile currently uses a broad `modelId.startsWith("mimo-v2")` profile:

- current-turn control: `thinking.type`
- replay carrier: `reasoning_content`
- no explicit `reasoning_effort` metadata
- every `mimo-v2*` model is treated as enable/disable capable

This is directionally close for current catalog models, but too broad for unprobed variants such as `mimo-v2-flash`.

## Reference Evidence

### OpenClaw

OpenClaw's bundled Xiaomi provider is an OpenAI-compatible provider at `https://api.xiaomimimo.com/v1`.

OpenClaw marks the following MiMo models as reasoning-capable:

- `mimo-v2-pro`
- `mimo-v2-omni`
- `mimo-v2.5`
- `mimo-v2.5-pro`
- `mimo-v2.6-pro`

OpenClaw does not include `mimo-v2-flash` in its thinking profile.

OpenClaw's MiMo request wrapper uses the DeepSeek V4 OpenAI-compatible thinking shape:

- enabled: `thinking: { "type": "enabled" }`
- disabled: `thinking: { "type": "disabled" }`
- effort: `reasoning_effort`
- replay: assistant `reasoning_content`

OpenClaw also has two MiMo-specific behaviors that need separate InfiniAI evidence before copying:

- Legacy visible-text promotion for `mimo-v2-pro` and `mimo-v2-omni` when the final answer appears only in thinking output.
- Anthropic-compatible Xiaomi replay where OpenAI-style `reasoning_content` is represented as unsigned Anthropic `thinking` blocks with `signature: "reasoning_content"`.

### Hermes

Hermes registers Xiaomi MiMo as a Chat Completions provider with aliases:

- `xiaomi`
- `mimo`
- `xiaomi-mimo`

Hermes also treats MiMo as a `reasoning_content` echo-back family. Its runtime preserves or reconstructs `assistant.reasoning_content` for providers that require thinking replay.

Hermes is weaker evidence than OpenClaw for exact MiMo transport patches, but it independently confirms the main replay carrier and default provider shape.

## Live Evidence Already Collected

All live probes below targeted InfiniAI's OpenAI-compatible `/chat/completions` route.

### Current-Turn Controls

Models:

- `mimo-v2.5-pro`
- `mimo-v2-pro`

Results:

- `thinking.type` omitted: accepted, default returned `reasoning_content`.
- `thinking.type=enabled`: accepted.
- `thinking.type=disabled`: accepted.
- `reasoning_effort=high` with thinking enabled: accepted.
- Non-stream and stream modes both accepted.

Summary: 12 pass, 4 observed default reasoning-content, 0 fail.

### Reasoning Effort Levels

Additional low/medium/high requests were run for both catalog MiMo models.

Results:

- `reasoning_effort=low`: accepted and returned `reasoning_content`.
- `reasoning_effort=medium`: accepted and returned `reasoning_content`.
- `reasoning_effort=high`: accepted and returned `reasoning_content`.

This supports exposing the model picker `Reasoning effort` control for current catalog MiMo models on the OpenAI-compatible route.

### Tool Replay

The existing `reasoning-content-tool-replay` probe passed for:

- `mimo-v2.5-pro`, non-stream
- `mimo-v2.5-pro`, stream
- `mimo-v2-pro`, non-stream
- `mimo-v2-pro`, stream

The first `mimo-v2-pro` replay run hit HTTP 429 quota, but retries later passed in both response modes.

This supports using `assistant.reasoning_content` replay for current catalog MiMo models.

### Anthropic Messages Boundary Probe

The existing Anthropic Messages reasoning wrapper was run for `mimo-v2.5-pro`.

Results:

- `thinking-disabled`: accepted and returned text only, no thinking block.
- `thinking-tool-replay`: accepted.
- `thinking-enabled-budget`: skipped by profile because explicit MiMo thinking-budget behavior is not verified.

This confirms the Anthropic route is not obviously broken, but it does not prove the OpenClaw-specific Xiaomi Anthropic `reasoning_content` dialect. It is not enough evidence to make Anthropic Messages the default MiMo route.

## New Targeted Probe Questions

The following targeted probes must be added and run before implementation is finalized:

1. MiMo visible-answer carrier check on Chat Completions.
   - Question: do current InfiniAI MiMo models ever put the user-visible final answer only in `reasoning_content` with empty `content`?
   - Implementation impact: only copy OpenClaw's legacy visible-text promotion if this is observed.

2. MiMo empty-array tool schema check on Chat Completions.
   - Question: does InfiniAI MiMo reject tool schemas with `items: []`?
   - Implementation impact: only add a MiMo tool-schema sanitizer if rejection is observed.

3. MiMo Anthropic stream field-shape check.
   - Question: does InfiniAI's Anthropic MiMo stream return native Anthropic `thinking_delta` / `signature_delta`, OpenAI-style `reasoning_content`, or only text?
   - Implementation impact: only copy OpenClaw's special Anthropic `reasoning_content` capture if the stream emits that dialect.

4. MiMo Anthropic synthetic `reasoning_content` replay check.
   - Question: does the Anthropic route accept a previous assistant tool-use message with a synthetic `thinking` block using `signature: "reasoning_content"`?
   - Implementation impact: only add synthetic unsigned Anthropic thinking-block replay if accepted and needed.

## Implementation Guidance Before New Probes

Safe implementation candidates:

1. Prefer OpenAI-compatible Chat Completions for MiMo catalog defaults.
2. Add MiMo OpenAI effort metadata:
   - `reasoningEffortControl: "openai-reasoning-effort"`
   - `defaultReasoningEffort: "high"`
3. Split broad MiMo OpenAI profile handling into explicit known reasoning IDs plus a safe-off profile for `mimo-v2-flash`.
4. Keep `reasoning_content` replay for OpenAI MiMo.
5. Keep removing `reasoning_effort` when thinking is disabled.

Do not implement yet:

1. Anthropic MiMo `reasoning_content` dialect handling.
2. Legacy thinking-only visible-answer promotion.
3. MiMo tool-schema sanitization.

Those require the targeted probe results above.

## Targeted Probe Results

New targeted probe runner:

- `/Users/yinghaozhao/code/github-yinghao/multibrand-docs/tools/api-probes/chat-completions/reasoning/probe-mimo-targets.mjs`

Live run:

```bash
zsh -lic 'node tools/api-probes/chat-completions/reasoning/probe-mimo-targets.mjs --out /private/tmp/mimo-targeted-probes-20260529 --timeout-ms 120000'
```

Artifacts:

- `/private/tmp/mimo-targeted-probes-20260529/latest.json`
- `/private/tmp/mimo-targeted-probes-20260529/2026-05-28T17-09-45-993Z/summary.json`
- `/private/tmp/mimo-targeted-probes-20260529/2026-05-28T17-09-45-993Z/details.json`

Summary:

- total accepted: 8
- total rejected: 2
- dry run: 0

### Chat Completions Visible-Answer Carrier

Models:

- `mimo-v2.5-pro`
- `mimo-v2-pro`

Results:

- Both models returned normal visible assistant `content`.
- Both models also returned `reasoning_content`.
- Both models included the expected final answer in normal visible content.
- Neither model needed visible-text promotion for the tested prompt.

Decision:

- Do not copy OpenClaw's legacy visible-answer promotion into the extension now.
- The extension should keep treating `reasoning_content` as hidden replay material, not as user-visible fallback text, unless a future probe captures an actual empty-content final answer.

### Chat Completions Empty-Array Tool Schema

Models:

- `mimo-v2.5-pro`
- `mimo-v2-pro`

Results:

- Both models rejected a tool schema containing `items: []`.
- Both rejections were HTTP 400.
- The provider error said the function parameters schema was invalid because `[]` is not an object or boolean schema.

Decision:

- Reuse the existing OpenAI tool-schema sanitizer for MiMo, not only Kimi.
- The important sanitizer behavior for this finding is converting array `items: []` to an object schema such as `items: {}`.
- This is a request-shape compatibility fix, not a thinking replay feature.

### Anthropic Messages Stream Field Shape

Models:

- `mimo-v2.5-pro`
- `mimo-v2-pro`

Results:

- Both Anthropic stream requests succeeded.
- Both streams emitted native Anthropic content block types:
  - `thinking`
  - `text`
- Both streams emitted native Anthropic delta types:
  - `thinking_delta`
  - `signature_delta`
  - `text_delta`
- Neither stream emitted an OpenAI-style `reasoning_content` field.

Decision:

- Do not copy OpenClaw's Xiaomi Anthropic `reasoning_content` capture path into the extension.
- If a user manually routes MiMo through Anthropic Messages, the extension's generic Anthropic thinking-block replay path is the right shape.
- The default route should still be OpenAI-compatible Chat Completions because both OpenClaw and Hermes use that as the primary Xiaomi provider shape, and InfiniAI Chat Completions probes already proved current-turn controls, effort, and replay.

### Anthropic Messages Synthetic Thinking Replay

Models:

- `mimo-v2.5-pro`
- `mimo-v2-pro`

Results:

- Both models accepted a synthetic previous assistant `thinking` block with `signature: "reasoning_content"` plus a `tool_use` block and tool result.
- Both models also accepted the same replay request with top-level assistant `reasoning_content`.

Decision:

- This proves the Anthropic route is tolerant, but it does not require a MiMo-specific Anthropic implementation.
- Native Anthropic streams already provide signed thinking blocks, so generic Anthropic thinking replay should be preferred.
- Do not add top-level Anthropic `reasoning_content`; accepting it is tolerance, not evidence that the extension should emit it.

## Final Implementation Decision

Implement these changes:

1. Prefer OpenAI-compatible Chat Completions for MiMo catalog defaults.
2. Add exact MiMo OpenAI reasoning profiles for the OpenClaw-confirmed reasoning IDs:
   - `mimo-v2-pro`
   - `mimo-v2-omni`
   - `mimo-v2.5`
   - `mimo-v2.5-pro`
   - `mimo-v2.6-pro`
3. For those exact MiMo reasoning IDs:
   - current-turn control: `thinking: { "type": "enabled" | "disabled" }`
   - replay carrier: `reasoning_content`
   - model picker `Thinking mode`: show enabled/disabled
   - model picker `Reasoning effort`: show low/medium/high
   - default request effort during replay-safe requests: `reasoning_effort: "high"`
4. Treat unprobed MiMo V2 variants, including `mimo-v2-flash`, as safe-off profiles:
   - default request thinking mode: disabled
   - no model picker enable control
   - no reasoning effort control
   - no built-in replay requirement
5. Reuse the existing strict OpenAI tool-schema sanitizer for MiMo so `items: []` is normalized before the request is sent.

Do not implement these OpenClaw behaviors now:

1. Legacy visible-text promotion from `reasoning_content` to visible assistant text.
2. MiMo-specific Anthropic `reasoning_content` stream capture.
3. Top-level Anthropic `reasoning_content` replay emission.

Those behaviors are either not observed on InfiniAI, unnecessary because the native route already emits standard Anthropic thinking blocks, or merely tolerated rather than required.

## Implemented Changes

Extension changes:

- `/Users/yinghaozhao/code/github/zenmux-copilot/src/route.ts`
  - MiMo catalog defaults now resolve to OpenAI-compatible Chat Completions before catalog `apiMode` metadata is applied.
  - User route overrides still win before this catalog preference.
- `/Users/yinghaozhao/code/github/zenmux-copilot/src/reasoningDialect.ts`
  - Exact OpenClaw-confirmed MiMo reasoning IDs now get the `mimo-v2-openai` profile.
  - That profile exposes `thinking.type`, `reasoning_content` replay, and OpenAI `reasoning_effort` with default `high`.
  - Other `mimo-v2*` IDs now get a safe-off profile with default disabled thinking and no effort control.
- `/Users/yinghaozhao/code/github/zenmux-copilot/src/openai/openaiApi.ts`
  - MiMo OpenAI requests now reuse the existing strict tool-schema sanitizer, fixing the live-probed `items: []` HTTP 400 case.

Probe changes:

- `/Users/yinghaozhao/code/github-yinghao/multibrand-docs/tools/api-probes/chat-completions/reasoning/probe-mimo-targets.mjs`
  - Adds reusable targeted MiMo probes for visible-answer carrier, empty-array tool schemas, Anthropic stream thinking fields, and Anthropic synthetic replay tolerance.

Test coverage added:

- `/Users/yinghaozhao/code/github/zenmux-copilot/src/route.test.ts`
  - MiMo catalog defaults prefer OpenAI-compatible routing even when metadata says Anthropic.
- `/Users/yinghaozhao/code/github/zenmux-copilot/src/reasoningDialect.test.ts`
  - Confirmed MiMo reasoning IDs expose replay and effort controls.
  - Unprobed MiMo V2 variants remain safe-off.
- `/Users/yinghaozhao/code/github/zenmux-copilot/src/modelConfiguration.test.ts`
  - Model picker exposes MiMo Thinking mode and Reasoning effort only for confirmed IDs.
  - Replay-safe MiMo OpenAI requests get default `reasoning_effort: "high"`.
- `/Users/yinghaozhao/code/github/zenmux-copilot/src/openaiApi.test.ts`
  - MiMo OpenAI request preparation normalizes `items: []` to `items: {}` before sending tools.

Verification:

- `pnpm test`: passed, 174 tests.
- `pnpm check`: not available in this repo (`Command "check" not found`).
