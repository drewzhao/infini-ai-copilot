# UX Enhancement Backlog

This backlog enumerates stable VS Code APIs (from `vscode.d.ts`) that could meaningfully improve the user experience of **InfiniAI Provider for Copilot**. Each item is grouped by impact tier, with design rationale, implementation guidance, suggested file layout, and acceptance criteria.

> Items #2–#6 and #11–#16 shipped in 0.5.0 and have been removed. Items #8a and #9a also shipped in 0.5.0; only their deferred 8b/9b follow-ups remain below.

---

## Table of Contents

- [Tier 2 — Strong UX upgrades](#tier-2--strong-ux-upgrades)
  - [7. UriHandler for one-click setup](#7-urihandler-for-one-click-setup)
  - [8. TreeView sidebar — Usage node (8b deferred)](#8-treeview-sidebar--infiniai-models)
  - [9. WebviewView usage dashboard (9b deferred)](#9-webviewview-usage-dashboard)
  - [10. Telemetry via env.createTelemetryLogger](#10-telemetry-via-envcreatetelemetrylogger)
- [Tier 3 — Polish additions](#tier-3--polish-additions)
  - [17. Additional commands](#17-additional-commands)
- [Tier 4 — Speculative but powerful](#tier-4--speculative-but-powerful)
  - [18. lm.registerTool — contribute language model tools](#18-lmregistertool--contribute-language-model-tools)
  - [19. lm.registerMcpServerDefinitionProvider](#19-lmregistermcpserverdefinitionprovider)
  - [20. workspace.registerTaskProvider — usage report task](#20-workspaceregistertaskprovider--usage-report-task)
- [Nice to have](#nice-to-have)
  - [21. Get-Started Walkthrough](#21-get-started-walkthrough)
- [Suggested roadmap](#suggested-roadmap)

---

## Tier 2 — Strong UX upgrades

### 7. UriHandler for one-click setup

> **Status: Deferred — blocked on the InfiniAI dashboard frontend.** The extension code is trivial (a `registerUriHandler` callback plus a confirmation modal); shipping it without the dashboard's matching "Open in VS Code" button would expose a publicly callable `vscode://…/setApiKey` URL with no real entry point. Revisit once the dashboard team adds the deep-link button (no new HTTP API required, just frontend work).

**Problem.** Copy/pasting a long API key from the dashboard is friction; users mis-paste with spaces.

**API.** `vscode.window.registerUriHandler({ handleUri(uri) { … } })`.

**Design.**
- Handle `vscode://drewzhao.infiniai-copilot/setApiKey?plan=standard&key=…`.
- After parsing, **always confirm** with a modal dialog ("Save API key from infini-ai.com?") before storing — never store silently.
- Optional: support `?plan=coding` and `?openWalkthrough=true`.

**Implementation guidance.**
```ts
context.subscriptions.push(vscode.window.registerUriHandler({
  async handleUri(uri) {
    const params = new URLSearchParams(uri.query);
    const plan = params.get("plan") === "coding" ? "coding" : "standard";
    const key = params.get("key")?.trim();
    if (!key) return;
    const confirm = await vscode.window.showInformationMessage(
      vscode.l10n.t("Save InfiniAI {0} API key received from {1}?", plan, uri.authority),
      { modal: true }, vscode.l10n.t("Save")
    );
    if (confirm) {
      await context.secrets.store(plan === "coding" ? "infiniai.codingApiKey" : "infiniai.apiKey", key);
    }
  }
}));
```
- Coordinate with the InfiniAI dashboard team to render a "Open in VS Code" button that builds this URL.
- **Security:** never accept keys from `?source=` redirects; show the source in the dialog.

**Acceptance criteria.**
- Clicking the dashboard's "Open in VS Code" link launches VS Code, surfaces a modal, and stores the key on confirmation.
- Plain `vscode://…` invocations without the user pressing the dashboard button cannot silently store keys.

---

### 8. TreeView sidebar — Usage node (8b)

> **Status: Partially shipped.** Part 8a (Plan / Models / Account nodes) shipped in 0.5.0. Part **8b** (Usage node) is **deferred — blocked on an InfiniAI account-level quota / billing query API**.

**Problem.** The Models tree lacks a **Usage** node showing account-level quota and billing data.

**Design.**
- **8b — Usage** *(deferred until the InfiniAI quota / billing API is available)* — render a non-clickable "Coming soon" leaf until the billing API ships, then populate with quota used / remaining.

**Acceptance criteria.**
- Usage node populates without requiring a tree-view schema change once the billing API is available.

---

### 9. WebviewView usage dashboard — Account-wide (9b)

> **Status: Partially shipped.** Part 9a (locally-observed token totals, local charts, Reset / Export CSV) shipped in 0.5.0. Part **9b** (account-wide aggregates, historical billing-accurate charts, cross-device numbers) is **deferred — blocked on an InfiniAI usage / billing query API**.

**Problem.** The local dashboard cannot show billing-accurate account-wide usage or cross-device totals.

**Design.**
- **9b** *(deferred)* — account-wide totals, billing units, multi-device aggregation; rendered as a disabled "Coming soon" panel until the InfiniAI usage API ships.

**Acceptance criteria.**
- Account-wide panel populates once the usage API is available; the local-activity panel continues to function independently.

---

### 10. Telemetry via env.createTelemetryLogger

> **Status: Deferred — blocked on an InfiniAI telemetry ingestion endpoint and a published retention / PII policy.** The `TelemetrySender` plumbing is one file, but without an HTTPS sink and a documented data-handling policy there is nowhere to send events and no way to make the privacy claims the README would need to make. Revisit once the backend exposes an analytics ingestion endpoint.

**Problem.** No visibility into model-id frequencies, retry rates, or user-facing errors makes regressions hard to spot.

**API.** `env.createTelemetryLogger(sender, options)` — automatically respects `env.isTelemetryEnabled` and the user's global telemetry setting.

**Design.**
- Implement a `TelemetrySender` that posts to InfiniAI's analytics endpoint (HTTPS only).
- Events: `provider.activate`, `models.fetched` (count), `request.completed` (model id hash, status, ttftMs, totalMs, retries), `error.<category>`.
- **Never** send: API keys, prompts, completion text, file contents, repo paths.
- Include extension version, VS Code version, OS/arch (already in UA).
- Document the scheme and PII guarantees in the README and link from the privacy section.

**Implementation guidance.**
```ts
const telemetry = env.createTelemetryLogger({
  sendEventData(event, data) { /* POST */ },
  sendErrorData(error, data) { /* POST */ },
});
context.subscriptions.push(telemetry);
telemetry.logUsage("request.completed", { model: hashModelId(id), retries, totalMs });
```
- Hash model ids if exposing them publicly is sensitive.
- Add a settings toggle `infiniai.telemetry.enabled` (defaulting to true) but always also gate on `env.isTelemetryEnabled`.

**Acceptance criteria.**
- With `telemetry.telemetryLevel: off`, no network calls are made.
- Verified events appear in the analytics backend within seconds.

---

## Tier 3 — Polish additions

### 17. Additional commands

Add and surface in the command palette + tree view actions:

| Command id | Title | Notes |
|---|---|---|
| `infiniai.switchPlan` | InfiniAI: Switch Plan | Quick pick + updates `infiniai.plan` |
| `infiniai.refreshModels` | InfiniAI: Refresh Models | Wired to `withProgress` |
| `infiniai.showLastRequest` | InfiniAI: Show Last Request | Reveals log channel and scrolls to last entry |
| `infiniai.clearApiKey` | InfiniAI: Clear API Key | Per-plan picker + confirm |
| `infiniai.openDashboard` | InfiniAI: Open Dashboard | `env.openExternal` |
| `infiniai.showUsage` | InfiniAI: Show Token Usage | Focuses the WebviewView |
| `infiniai.openWalkthrough` | InfiniAI: Open Walkthrough | Reopens item #21 |

Use `category: "InfiniAI"` for all commands and group them in the palette.

---

## Tier 4 — Speculative but powerful

### 18. lm.registerTool — contribute language model tools

> **Status: Split.** Part **18a** (`infiniai_list_models`) ships now against the existing `/v1/models` endpoint. Part **18b** (`infiniai_estimate_cost`, `infiniai_pick_model`) is **deferred — blocked on an InfiniAI pricing API (or a stable published price sheet) and, for the recommender, an optional server-side model-suggestion endpoint**.

**Problem.** The provider is passive; it cannot expose InfiniAI-specific helpers (model discovery, pricing) to *other* models in the same chat.

**API.** `vscode.lm.registerTool<T>(name, tool)` + manifest `contributes.languageModelTools`.

**Design.** Candidate tools:
- **18a** *(ships now)* — `infiniai_list_models` — returns the latest model catalog with capabilities. **Source from `provider.getModelCache(...)`** rather than calling `/v1/models` directly so the tool benefits from the existing TTL cache, in-flight dedupe, and last-good fallback added in PR #5.
- **18b** *(deferred until a pricing API or published price sheet exists)* — `infiniai_estimate_cost` — input: `{ model, inputTokens, outputTokens }`; output: estimated cost.
- **18b** *(deferred until a recommender endpoint or curated mapping ships)* — `infiniai_pick_model` — takes a task description, returns a recommended model id.

**Implementation guidance.** Follow the pattern in <https://github.com/microsoft/vscode-extension-samples/tree/main/lm-tools-sample>. Use small, deterministic outputs to keep prompts cheap.

---

### 19. lm.registerMcpServerDefinitionProvider

> **Status: Deferred — blocked on InfiniAI exposing MCP-compatible server endpoints.** The entire feature is gated on backend product work; until those endpoints exist there is nothing for the provider to publish.

**Problem.** If/when InfiniAI exposes MCP-compatible endpoints, users currently must hand-edit `mcp.json`.

**API.** `vscode.lm.registerMcpServerDefinitionProvider(id, provider)`.

**Design.** Auto-publish MCP server definitions for the user's account so they appear in the MCP picker without manual config.

---

### 20. workspace.registerTaskProvider — usage report task

> **Status: Deferred — blocked on the same InfiniAI usage / billing query API as #9b.** A CSV that only reports locally-observed activity would mislead Coding-Plan customers tracking real spend, so this should not ship until the backing API does.

**Problem.** Power users want a one-keystroke "give me a monthly usage CSV".

**API.** `vscode.tasks.registerTaskProvider("infiniai", provider)`.

**Design.** Contribute `provideTasks` returning a `Task` of kind `"infiniai"`, type `"usage-report"`, with `presentationOptions: { reveal: Always }`. The task spawns no shell; instead it uses a `CustomExecution` to run an in-process function that fetches usage, writes to `globalStorageUri/usage-YYYY-MM.csv`, and opens the file.

Niche but appreciated by Coding-Plan customers tracking spend.

---

## Nice to have

### 21. Get-Started Walkthrough

**Problem.** First-run users currently have to read the README to discover the multi-step path: open Copilot Chat → model picker → "Manage Models" → "Add Models" → "InfiniAI" → choose plan → enter API key → select models. Drop-off here is high.

> Deprioritized: most early adopters arrive via the README and dashboard deep links. Revisit once telemetry (#10) confirms onboarding drop-off is a real bottleneck, or after the dashboard's "Open in VS Code" flow (#7) is live and we want a guided fallback.

**API.** Manifest contribution `walkthroughs` (declared in `package.json`; rendered by VS Code under **Welcome → Get Started**).

**Design.**
- 4–5 steps, each with a Markdown body, a media asset (PNG/SVG/MP4) and a `command:` link that performs the step.
- Steps:
  1. **Pick your plan** — runs `infiniai.pickPlan` (new command, just sets `infiniai.plan`).
  2. **Add your API key** — runs `infiniai.setApikey` (existing).
  3. **Open Copilot Chat & select InfiniAI** — runs `workbench.action.chat.open`.
  4. **Pin your favorite models** — runs a new `infiniai.pinModels` quick pick (or links to the model picker).
  5. **Optional: switch to Coding Plan** — runs `infiniai.switchPlan`.
- Each step uses `completionEvents` like `onCommand:infiniai.setApikey` so the checkmark auto-ticks when the user completes it through any path.

**Implementation guidance.**
- Add to `package.json`:
  ```jsonc
  "contributes": {
    "walkthroughs": [{
      "id": "infiniai.gettingStarted",
      "title": "Get Started with InfiniAI",
      "description": "Set up the InfiniAI provider for GitHub Copilot Chat",
      "steps": [ /* 4–5 step entries */ ]
    }]
  }
  ```
- Place media under `assets/walkthrough/` (light/dark variants where useful).
- Trigger the walkthrough on first activation only:
  ```ts
  if (!context.globalState.get("infiniai.welcomed")) {
    vscode.commands.executeCommand(
      "workbench.action.openWalkthrough",
      "drewzhao.infiniai-copilot#infiniai.gettingStarted",
      false
    );
    context.globalState.update("infiniai.welcomed", true);
  }
  ```

**Acceptance criteria.**
- Fresh install → walkthrough auto-opens once.
- "InfiniAI: Open Walkthrough" command reopens it.
- Each step's checkmark updates without a window reload.

---

## Suggested roadmap

| Sprint | Items | Rationale |
|---|---|---|
| **S1–S6** ✅ | ~~#2 LogOutputChannel, #3 withProgress, #4 onDidChangeConfiguration, #5 Localization, #6 AuthenticationProvider, #8a TreeView, #9a local usage dashboard, #11 error toasts, #12 QuickPick builder, #13 SecretStorage.onDidChange, #14 dependency detection, #15 LanguageStatusItem, #16 env.uiKind~~ | All shipped in 0.5.0 |
| **Pending** | #17 additional commands, #18a `infiniai_list_models` tool | Not yet implemented; no server-side dependency |
| **Deferred — server-side dependency** | #7 UriHandler *(needs dashboard "Open in VS Code" button)*, #8b Usage tree node, #9b account-wide dashboard, #10 telemetry, #18b cost / picker tools, #19 MCP provider, #20 usage-report task | Pulled out of the active roadmap until the matching InfiniAI backend / dashboard capability ships |
| **Nice to have** | #21 Walkthrough | Revisit only if onboarding telemetry shows drop-off |

---

## Cross-cutting non-goals

- **No new runtime dependencies** beyond what's already shipped, unless explicitly justified per item.
- **No changes to wire protocol** (OpenAI/Anthropic/Vertex shape) as part of these UX items.

---

## Shipped beyond the backlog

Features that landed via PR #5 (commit f58cce1) but were not anticipated by this document:

### `@infiniai` chat participant — `/doctor`, `/models`, `/test`

- **File.** `src/participant.ts` + `chatParticipants` contribution in `package.json`.
- **Why it stays.** Native to in-chat focus, and `/test` (a one-shot ping that exercises the configured route end-to-end) is **net-new functionality** not covered by any tree, status item, or settings page.
- **Relationship to backlogged items.**
  - **#8 (TreeView):** complementary — the tree is the always-visible glanceable surface; the participant is the in-chat surface. `/models` and the tree's Models node should not duplicate output verbatim; defer detailed per-model dumps to `/models`.
  - **#14 (dependency detection):** does **not** replace the activate-time toast — `/doctor` is unreachable when Copilot Chat is missing.
  - **#17 (commands):** `infiniai.refreshModels` is still worth shipping for non-chat surfaces (tree title-bar action, command palette); keep it alongside `/models refresh`.

### Provider modernization (cache TTL, in-flight dedupe, last-good fallback, route metadata, typed errors, redacted logging)

- **Files.** `src/provider.ts`, `src/utils.ts`, `src/route.ts`, `src/sse.ts`, `src/retry.ts`.
- **New config keys.** `infiniai.modelDiscoveryUrl`, `infiniai.modelCacheTtlMs`, `infiniai.modelRoutes`.
- **Backlog impact.** Removes the need to re-litigate the discovery/cache/transport design in any future item; future tree / dashboard / tool work should consume the existing cache rather than duplicating it.
