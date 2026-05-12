# UX Enhancement Backlog

This backlog enumerates stable VS Code APIs (from `vscode.d.ts`) that could meaningfully improve the user experience of **InfiniAI Provider for Copilot**. Each item is grouped by impact tier, with design rationale, implementation guidance, suggested file layout, and acceptance criteria.

> All items are buildable today against the existing `engines.vscode: ^1.104.0` and require **no proposed APIs**.

---

## Table of Contents

- [Tier 1 — Highest UX wins](#tier-1--highest-ux-wins)
  - [2. LogOutputChannel](#2-logoutputchannel)
  - [3. Progress notifications for long operations](#3-progress-notifications-for-long-operations)
  - [4. Live reaction to configuration changes](#4-live-reaction-to-configuration-changes)
  - [5. Localization with vscode.l10n](#5-localization-with-vscodel10n)
- [Tier 2 — Strong UX upgrades](#tier-2--strong-ux-upgrades)
  - [6. AuthenticationProvider for API keys](#6-authenticationprovider-for-api-keys)
  - [7. UriHandler for one-click setup](#7-urihandler-for-one-click-setup)
  - [8. TreeView sidebar — InfiniAI Models](#8-treeview-sidebar--infiniai-models)
  - [9. WebviewView usage dashboard](#9-webviewview-usage-dashboard)
  - [10. Telemetry via env.createTelemetryLogger](#10-telemetry-via-envcreatetelemetrylogger)
- [Tier 3 — Polish additions](#tier-3--polish-additions)
  - [11. Action buttons via env.openExternal](#11-action-buttons-via-envopenexternal)
  - [12. window.createQuickPick builder for richer pickers](#12-windowcreatequickpick-builder-for-richer-pickers)
  - [13. SecretStorage.onDidChange for cross-window sync](#13-secretstorageondidchange-for-cross-window-sync)
  - [14. Detect Copilot Chat dependency state](#14-detect-copilot-chat-dependency-state)
  - [15. LanguageStatusItem for contextual model display](#15-languagestatusitem-for-contextual-model-display)
  - [16. env.uiKind — graceful web degradation](#16-envuikind--graceful-web-degradation)
  - [17. Additional commands](#17-additional-commands)
- [Tier 4 — Speculative but powerful](#tier-4--speculative-but-powerful)
  - [18. lm.registerTool — contribute language model tools](#18-lmregistertool--contribute-language-model-tools)
  - [19. lm.registerMcpServerDefinitionProvider](#19-lmregistermcpserverdefinitionprovider)
  - [20. workspace.registerTaskProvider — usage report task](#20-workspaceregistertaskprovider--usage-report-task)
- [Nice to have](#nice-to-have)
  - [21. Get-Started Walkthrough](#21-get-started-walkthrough)
- [Suggested roadmap](#suggested-roadmap)

---

## Tier 1 — Highest UX wins

### 2. LogOutputChannel

**Problem.** `createOutputChannel("InfiniAI")` produces a plain text channel with no log levels and no timestamps. Users cannot quiet it or raise verbosity.

**API.** `vscode.window.createOutputChannel(name, { log: true }): LogOutputChannel`.

**Design.** Drop-in replacement. Replace `output.appendLine(msg)` with one of `log.trace`, `log.debug`, `log.info`, `log.warn`, `log.error`. The channel respects per-channel log level configurable via "Developer: Set Log Level…".

**Implementation guidance.**
- Centralize logging behind a small helper:
  ```ts
  // src/log.ts
  let log: vscode.LogOutputChannel;
  export function initLog(ctx: vscode.ExtensionContext) {
    log = vscode.window.createOutputChannel("InfiniAI", { log: true });
    ctx.subscriptions.push(log);
    return log;
  }
  export function getLog() { return log; }
  ```
- Pass `log` (typed `LogOutputChannel`) into `InfiniAIChatModelProvider` instead of the current `OutputChannel`.
- Audit existing call sites to assign appropriate severities: model-fetch start = `info`; per-request payload trace = `trace`; retry warnings = `warn`; HTTP errors = `error`.

**Acceptance criteria.**
- Channel appears as a "Log" channel (with the log icon) in the Output dropdown.
- Setting log level to "Off" suppresses all messages without code changes.
- Stack traces from caught errors appear on a single error entry.

---

### 3. Progress notifications for long operations

**Problem.** `fetchModels()`, retries, and slow chat calls happen silently. Users don't know if anything is happening.

**API.** `vscode.window.withProgress({ location: ProgressLocation.Notification, cancellable: true, title }, async (progress, token) => …)`.

**Design.**
- Wrap `fetchModels` and the model picker refresh with a notification-style progress that surfaces "Fetching InfiniAI models…" and supports cancel.
- For per-request progress, prefer `ProgressLocation.Window` (compact, non-modal) so it doesn't spam the user during chat streaming.
- Forward the `CancellationToken` into HTTP layers; cancel in `executeWithRetry`.

**Implementation guidance.**
- Refactor `utils.fetchModels` to accept an optional `CancellationToken` that aborts the underlying `fetch`.
- In `provideLanguageModelChatInformation`, wrap fetch in `withProgress`. For `silent: true` (the IDE polling silently), skip the progress UI.
- Use `progress.report({ message, increment })` between retry attempts.

**Acceptance criteria.**
- Triggering a manual "Refresh Models" shows a cancelable notification.
- Cancel actually aborts the in-flight HTTP request (not just hides the toast).

---

### 4. Live reaction to configuration changes

**Problem.** Changing `infiniai.plan`, `infiniai.baseUrl`, or `infiniai.coding.baseUrl` requires a window reload before they take effect. This is a frequent source of confusion.

**API.** `vscode.workspace.onDidChangeConfiguration(e => …)`.

**Design.**
- Subscribe in `activate`. When `e.affectsConfiguration("infiniai")`:
  - If plan changed → re-resolve API key, refresh model list.
  - If `baseUrl` / `anthropic.baseUrl` / `coding.*` changed → invalidate cached models, refresh.
  - If `imageInputModels` / `disableImageInputModels` changed → re-emit model info (image flag may flip).
- Debounce (200–500 ms) since users may type into a settings JSON file.

**Implementation guidance.**
```ts
let debounce: NodeJS.Timeout | undefined;
context.subscriptions.push(
  vscode.workspace.onDidChangeConfiguration(e => {
    if (!e.affectsConfiguration("infiniai")) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => provider.refresh(), 300);
  })
);
```
- Add `refresh()` to `InfiniAIChatModelProvider`. It should clear `_models`, re-fetch, and notify the IDE — VS Code will call `provideLanguageModelChatInformation` again on demand.

**Acceptance criteria.**
- Toggling `infiniai.plan` from `standard` to `coding` and back updates the model list within ~1 s without reload.
- Editing `infiniai.baseUrl` triggers a single refresh, not one-per-keystroke.

---

### 5. Localization with vscode.l10n

**Problem.** README is bilingual but the running UI is English-only. The primary user base is Chinese-speaking.

**API.** `vscode.l10n.t(message, …args)` for runtime strings + `package.nls.<locale>.json` for manifest strings.

**Design.**
- Wrap all user-visible runtime strings in `vscode.l10n.t(...)`.
- Externalize all `package.json` `description`, `title`, `enumDescriptions` into `%key%` placeholders backed by `package.nls.json` (English fallback) and `package.nls.zh-cn.json` (translations).
- Add `"l10n": "./l10n"` to `package.json` and ship `l10n/bundle.l10n.zh-cn.json`.

**Implementation guidance.**
- File layout:
  ```
  package.nls.json
  package.nls.zh-cn.json
  l10n/
    bundle.l10n.json          (optional source)
    bundle.l10n.zh-cn.json    (zh-CN translations)
  ```
- Use `npx @vscode/l10n-dev export -o ./l10n ./src` to extract strings.
- Avoid string concatenation in `t()`; pass interpolation args:
  ```ts
  vscode.l10n.t("InfiniAI {0} API key saved.", planLabel)
  ```

**Acceptance criteria.**
- Setting VS Code display language to `zh-cn` (`Configure Display Language`) shows Chinese command titles, settings descriptions, and prompts.
- Falls back to English when no translation exists.

---

## Tier 2 — Strong UX upgrades

### 6. AuthenticationProvider for API keys

**Problem.** API keys are stored under raw `SecretStorage` keys (`infiniai.apiKey`, `infiniai.codingApiKey`). Users have no central place to view, switch, or sign out.

**API.** `vscode.authentication.registerAuthenticationProvider(id, label, provider, { supportsMultipleAccounts })`.

**Design.**
- Implement `AuthenticationProvider` with two "accounts": `standard` and `coding`.
- `getSessions(scopes?)` reads from `SecretStorage`; `createSession(scopes)` shows the current API-key input flow; `removeSession(sessionId)` clears the secret.
- Each session's `accessToken` = the API key; `account.label` = "Standard Plan" / "Coding Plan".
- Optionally publish the session via `vscode.authentication.getSession("infiniai", ["chat"], { silent: true })` so other extensions could consume the key in a controlled way (decide intentionally — security implications).

**Implementation guidance.**
- File: `src/auth/infiniaiAuthProvider.ts`.
- Surface in **Accounts** menu (gear icon, lower-left) automatically.
- Keep `infiniai.setApikey` as a thin wrapper that internally calls `createSession`.

**Acceptance criteria.**
- Account icon shows "InfiniAI (Standard Plan)" with a sign-out option.
- Switching accounts swaps which key the provider uses for subsequent requests.

---

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

### 8. TreeView sidebar — InfiniAI Models

> **Status: Split.** Part **8a** (Plan / Models / Account nodes) ships now against existing endpoints. Part **8b** (Usage node) is **deferred — blocked on an InfiniAI account-level quota / billing query API**.

**Problem.** The single status-bar item is the only persistent surface. Users have no central place to see/manage models, plans, or quotas.

**API.** Manifest `viewsContainers` + `views`; runtime `window.registerTreeDataProvider` (or `createTreeView` for richer control).

**Design.**
- Activity-bar icon → "InfiniAI" container with one view: **Models**.
- Top-level nodes:
  - **8a — Plan** *(ships now)* — "Standard" / "Coding" badge with a switch action.
  - **8a — Models** *(ships now)* — children = available models, each with `description` (context length), `tooltip` (full info), inline actions: "Pin", "Show details".
  - **8a — Account** *(ships now)* — current key fingerprint (last 4), "Manage Keys", "Open Dashboard".
  - **8b — Usage** *(deferred until the InfiniAI quota / billing API is available)* — render a non-clickable "Coming soon" leaf in the meantime so the slot is reserved.
- Title-bar actions: "Refresh" (`infiniai.refreshModels`), "Settings" (`workbench.action.openSettings infiniai`).

**Implementation guidance.**
- File: `src/views/modelsView.ts` implementing `TreeDataProvider<InfiniNode>`.
- Use `EventEmitter<InfiniNode | undefined>` to fire `onDidChangeTreeData` on plan/key/model changes.
- Use `ThemeIcon` for icons (`new vscode.ThemeIcon("rocket")` etc.) — works in all themes.
- Wire context menus via `package.json`'s `menus.view/item/context` against `when: viewItem == infiniai.model`.

**Acceptance criteria.**
- View persists across reloads; refresh button works.
- Plan switch changes the underlying model list within 1 s.

---

### 9. WebviewView usage dashboard

> **Status: Split.** Part **9a** (locally-observed token totals from streaming responses, persisted in `globalState`) ships now. Part **9b** (account-wide aggregates, historical billing-accurate charts, cross-device numbers) is **deferred — blocked on an InfiniAI usage / billing query API**.

**Problem.** Token counts surface only as a status-bar tooltip. Power users want trends and per-model breakdowns.

**API.** `vscode.window.registerWebviewViewProvider(viewId, provider)` (registered against the same view container as item 8) + `WebviewView.webview.html`.

**Design.**
- Sibling view in the InfiniAI container: **Usage**.
- Webview renders:
  - **9a** *(ships now)* — current session token totals (in/out/cached) computed from streaming responses observed in this window.
  - **9a** *(ships now)* — per-model usage chart (last 24h / 7d) sourced from the local `globalState` rolling window; clearly labeled "Local activity (this device)".
  - **9a** *(ships now)* — "Reset" button (clears local state) and "Export CSV" of locally-observed records.
  - **9b** *(deferred)* — account-wide totals, billing units, multi-device aggregation; rendered as a disabled "Coming soon" panel until the InfiniAI usage API ships.
- Use a tiny vanilla-JS chart (no React) to keep bundle small. CSP must include `default-src 'none'; script-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline';`.

**Implementation guidance.**
- File: `src/views/usageDashboard.ts`.
- Persist a rolling window of `{ ts, model, in, out, cached }` records (cap ~10k) in `context.globalState` to survive reloads.
- Use `webview.postMessage` to push live updates as new responses complete; the webview should not poll.
- Theme: subscribe to `window.onDidChangeActiveColorTheme` and re-render to track light/dark.

**Acceptance criteria.**
- Numbers visibly update during a chat without reopening the view.
- Survives window reload with last-7-day data intact.

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

### 11. Action buttons via env.openExternal

**Problem.** Error toasts dead-end the user.

**API.** `vscode.window.showErrorMessage(msg, …actions)` + `env.openExternal(Uri)`.

**Design.** Every recoverable error should offer at least one action.

**Implementation guidance.**
```ts
const choice = await vscode.window.showErrorMessage(
  vscode.l10n.t("InfiniAI API key invalid"),
  vscode.l10n.t("Get API Key"),
  vscode.l10n.t("Open Settings"),
);
if (choice === vscode.l10n.t("Get API Key")) {
  await vscode.env.openExternal(vscode.Uri.parse("https://infiniai.ai/keys"));
} else if (choice === vscode.l10n.t("Open Settings")) {
  await vscode.commands.executeCommand("workbench.action.openSettings", "infiniai");
}
```
- Catalog the recoverable error categories (401, 402 quota, 429 rate limit, 5xx, network, model-not-found) and the action set per category.

**Acceptance criteria.** Each error category has ≥1 action that resolves the underlying issue without manual navigation.

---

### 12. window.createQuickPick builder for richer pickers

**Problem.** `showQuickPick` is one-shot; we can't show busy state, separators, or multi-step flows.

**API.** `window.createQuickPick<T extends QuickPickItem>()`.

**Design.** Replace plan picker, model picker, and any future selector. Adds:
- `busy = true` while validating an entered API key against `/health`.
- Item separators (`QuickPickItemKind.Separator`) to group "Standard models" vs "Coding-only models".
- `buttons` (per-item gear icons) → "Set as default", "Configure baseUrl".
- Back navigation (`onDidTriggerButton` with `QuickInputButtons.Back`) for multi-step flows.

**Implementation guidance.** Keep helpers in `src/ui/quickPick.ts` (`pickPlanQP()`, `pickModelsQP()`).

---

### 13. SecretStorage.onDidChange for cross-window sync

**Problem.** Editing the API key in window A doesn't refresh the model list in window B.

**API.** `context.secrets.onDidChange((e) => …)`.

**Design.**
```ts
context.subscriptions.push(context.secrets.onDidChange(e => {
  if (e.key === "infiniai.apiKey" || e.key === "infiniai.codingApiKey") {
    provider.refresh();
  }
}));
```

**Acceptance criteria.** Saving a new key in window A updates window B's status bar within ~1 s.

---

### 14. Detect Copilot Chat dependency state

**Problem.** Without `github.copilot-chat` installed/active, our provider registers nothing visible and the user is confused.

**API.** `vscode.extensions.getExtension("github.copilot-chat")` + `vscode.extensions.onDidChange`.

**Design.**
- On activate, check presence and `isActive`.
- If missing → one-time information message "GitHub Copilot Chat is required to use InfiniAI models" with action "Install Copilot Chat" calling `workbench.extensions.installExtension`.
- Listen for `onDidChange` to clear the warning once installed.

**Acceptance criteria.** Uninstalling Copilot Chat surfaces a friendly install prompt; reinstalling clears it without reload.

---

### 15. LanguageStatusItem for contextual model display

**Problem.** Status-bar item is always present, even in non-code editors.

**API.** `vscode.languages.createLanguageStatusItem(id, selector)`.

**Design.** Show "InfiniAI: <model> · 12K/128K" only when the active editor matches a code document selector. Promote it to `LanguageStatusSeverity.Warning` when usage > 90 %. Keep the existing global status bar for now or migrate fully — see metrics first.

**Implementation guidance.**
```ts
const item = vscode.languages.createLanguageStatusItem("infiniai.model",
  [{ scheme: "file" }]);
item.name = "InfiniAI";
item.text = `$(rocket) ${modelName}`;
item.detail = `${used.toLocaleString()} / ${max.toLocaleString()} tokens`;
```

---

### 16. env.uiKind — graceful web degradation

**Problem.** A future `vscode-web` build would crash if it assumed Node.

**API.** `env.uiKind === UIKind.Web`.

**Design.** Gate Node-only paths (FS, child_process). Currently the extension is HTTP-only, so it should already be web-compatible — verify and add `"browser": "./dist/web/extension.js"` if you ship a web build.

---

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
- **18a** *(ships now)* — `infiniai_list_models` — returns the latest model catalog with capabilities (sourced from `/v1/models`).
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
| **S1** | #2 LogOutputChannel, #4 onDidChangeConfiguration | Tiny code surface, immediate diagnostic + reactivity wins |
| **S2** | #3 withProgress, #11 action buttons, #13 SecretStorage.onDidChange, #14 dependency detection | Round out daily-use polish |
| **S3** | #5 Localization (zh-cn) | Big win for primary market |
| **S4** | #8a TreeView (Plan / Models / Account), #17 commands | Establish the InfiniAI sidebar as the central hub |
| **S5** | #6 AuthenticationProvider | Account-grade key management |
| **S6** | #9a Local usage dashboard, #18a `infiniai_list_models` tool | Insight from data we already observe locally |
| **Later** | #12 quick-pick builder, #15 LanguageStatusItem, #16 web kind | Polish |
| **Deferred — server-side dependency** | #7 UriHandler *(needs dashboard "Open in VS Code" button)*, #8b Usage tree node, #9b account-wide dashboard, #10 telemetry, #18b cost / picker tools, #19 MCP provider, #20 usage-report task | Pulled out of the active roadmap until the matching InfiniAI backend / dashboard capability ships |
| **Nice to have** | #21 Walkthrough | Revisit only if onboarding telemetry shows drop-off |

---

## Cross-cutting non-goals

- **No proposed APIs.** Everything above is in stable `vscode.d.ts` for `engines.vscode: ^1.104.0`.
- **No new runtime dependencies** beyond what's already shipped, unless explicitly justified per item.
- **No changes to wire protocol** (OpenAI/Anthropic/Vertex shape) as part of these UX items.
