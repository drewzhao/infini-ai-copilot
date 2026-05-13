# InfiniAI Provider for VS Code

InfiniAI Provider for VS Code registers InfiniAI as a stable VS Code language model provider and adds an `@infiniai` diagnostics participant. It uses only public VS Code APIs and does not depend on the standalone `github.copilot-chat` extension or Copilot private/proposed APIs.

## Usage

1. Install the extension from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=drewzhao.infiniai-copilot).
2. Open VS Code Chat and use the model picker.
3. Choose **Manage Models...**, then add models from the **InfiniAI** provider.
4. Pick the Standard or Coding plan when prompted.
5. Enter the matching InfiniAI API key. The key is stored in VS Code Secret Storage.
6. Select an InfiniAI model from the model picker.

You can also use `@infiniai` in Chat for diagnostics:

- `@infiniai /doctor` checks configuration, key presence, endpoint settings, cache state, and the last sanitized provider error.
- `@infiniai /models` lists discovered models and route capabilities from the local cache.
- `@infiniai /models refresh` refreshes model discovery before listing models.
- `@infiniai /test` runs a minimal cancellable health request against the selected/default route.

The participant is diagnostic only. It is not a replacement chat assistant.

## Requirements

- VS Code `^1.117.0`
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
npm run build
```

To run the extension locally:

1. Open this repository in VS Code `1.117+`.
2. Press `F5` to launch the Extension Development Host.
3. In the development host, use the model picker to add InfiniAI models or run `@infiniai /doctor`.

## Activation And Logging

The manifest keeps activation lazy. VS Code automatically activates the extension when its stable language model provider or chat participant contribution is needed, or when `infiniai.setApikey` is invoked.

Logs are written to a VS Code `LogOutputChannel` named `InfiniAI`. The extension redacts secrets, prompts, tool results, image data, auth headers, and full response bodies.

Useful log fields include request id, model id, provider transport, endpoint host/path, HTTP status, retry attempt, elapsed time, streamed bytes, and finish reason.

## Configuration

Common settings:

- `infiniai.plan`: Select `"standard"` or `"coding"`. If unset, routing defaults to `"standard"` and the key-entry flow prompts for a plan.
- `infiniai.baseUrl`: OpenAI-compatible Standard Plan base URL.
- `infiniai.anthropic.baseUrl`: Anthropic-compatible Standard Plan base URL.
- `infiniai.coding.baseUrl`: OpenAI-compatible Coding Plan base URL.
- `infiniai.coding.anthropic.baseUrl`: Anthropic-compatible Coding Plan base URL.
- `infiniai.modelDiscoveryUrl`: Optional absolute URL for model discovery. Empty uses the selected InfiniAI plan default.
- `infiniai.modelCacheTtlMs`: Model discovery cache TTL in milliseconds. Set `0` to refresh every request.
- `infiniai.modelRoutes`: Optional model routing overrides. Each item supports `pattern`, `transport` (`"openai"`, `"anthropic"`, or `"vertex"`), and optional `baseUrl`.
- `infiniai.imageInputModels`: Force-enable image input for matching model IDs. Supports `*` wildcards.
- `infiniai.disableImageInputModels`: Force-disable image input for matching model IDs. Supports `*` wildcards.
- `infiniai.disableThinkingForModels`: Model ID patterns whose thinking mode is force-disabled when the host cannot round-trip `reasoning_content`. Defaults cover known Xiaomi MiMo V2 model IDs and the DeepSeek V4 family: `mimo-v2-pro`, `mimo-v2.5-pro`, `mimo-v2.5`, `mimo-v2-omni`, `mimo-v2-flash`, `deepseek-v4*`. See [Thinking mode](#thinking-mode) below.
- `infiniai.retry`: Retry policy for retryable network and HTTP failures.
- `infiniai.delay`: Fixed delay between requests, in milliseconds.

Routing precedence:

1. User `infiniai.modelRoutes` pattern match.
2. Explicit InfiniAI model metadata.
3. Provider-owned catalog metadata.
4. Conservative OpenAI-compatible fallback.

Transport behavior:

- OpenAI-compatible routes call `/chat/completions`.
- Anthropic routes call `/v1/messages` with `x-api-key` and `anthropic-version`.
- Vertex routes call `:streamGenerateContent` using the Vertex adapter.

Unsupported endpoint families fail with a clear provider error instead of silently falling back.

## Thinking mode

Some InfiniAI models stream a `reasoning_content` chain-of-thought in addition to the regular assistant text. Their APIs (currently known Xiaomi MiMo V2 model IDs and the DeepSeek V4 family) require that `reasoning_content` be **echoed back verbatim** on subsequent turns whenever the conversation contains tool calls. If it is missing, the upstream returns:

```
HTTP 400 — reasoning_content is required when the previous assistant message contains tool calls
```

The stable VS Code language-model API (`vscode.LanguageModelChatMessage`) has no public part type for thinking/reasoning content — `LanguageModelThinkingPart` is a proposed API. On stable VS Code the extension therefore cannot persist or replay reasoning content across turns and falls back to the workaround below. On VS Code Insiders the extension automatically detects the proposed API at runtime and round-trips `reasoning_content` end-to-end (see [Insiders: end-to-end thinking mode](#insiders-end-to-end-thinking-mode)).

To avoid the 400 error out of the box on stable VS Code, the extension force-disables thinking mode on the affected model IDs/families by injecting both vendor flavors into the request body:

```jsonc
{
  "enable_thinking": false,
  "thinking": { "type": "disabled" }
}
```

Defaults disabled on stable hosts: `mimo-v2-pro`, `mimo-v2.5-pro`, `mimo-v2.5`, `mimo-v2-omni`, `mimo-v2-flash` (known Xiaomi MiMo V2 model IDs), and `deepseek-v4*` (any DeepSeek V4 variant).

**Trade-off**: chain-of-thought quality on these specific models. Tool-calling and regular replies still work normally; other models (Kimi K2 Thinking, DeepSeek R1, DeepSeek V3.x, Qwen, GLM, etc.) are not affected and keep their thinking mode.

**Override** via `infiniai.disableThinkingForModels`:

- Add a pattern (e.g. `"my-thinker-*"`) to extend the disable list.
- Set to `[]` to allow thinking on stable hosts for the default models — only do this if you have an external workaround for round-tripping `reasoning_content` (e.g. an MCP proxy or a custom transport). On hosts with `LanguageModelThinkingPart`, the extension round-trips `reasoning_content` instead and does not apply this fallback.

### Insiders: end-to-end thinking mode

The extension manifest declares `enabledApiProposals: ["languageModelThinkingPart"]`. When the host actually exposes that proposed API at runtime, the extension automatically:

1. Streams reasoning chunks as `LanguageModelThinkingPart` parts so the chat UI preserves them across turns.
2. Echoes `reasoning_content` back to MiMo V2 / DeepSeek V4 on subsequent turns, avoiding the HTTP 400.
3. Skips the force-disable injection so the model can think freely.

To opt in, launch VS Code Insiders with proposed APIs enabled for this publisher:

```sh
code-insiders --enable-proposed-api drewzhao.infiniai-copilot
```

Alternatively add the publisher id to `argv.json` (Command Palette → "Preferences: Configure Runtime Arguments"):

```jsonc
{
  "enable-proposed-api": ["drewzhao.infiniai-copilot"]
}
```

No setting toggle is needed — detection is automatic. On stable VS Code (or Insiders without the flag) the constructor is `undefined` and the extension transparently falls back to the disable behavior described above.

## Commands

- `infiniai.setApikey`: Set, update, or delete the Standard or Coding plan API key.

Chat participant commands:

- `@infiniai /doctor`
- `@infiniai /models`
- `@infiniai /models refresh`
- `@infiniai /test`

## Stable API Policy

This extension intentionally avoids:

- `enabledApiProposals`
- `src/vscode.proposed.*.d.ts`
- Copilot private commands or extension IDs
- `configurationSchema`
- `modelConfiguration`
- `chatParticipantAdditions`
- `defaultChatParticipant`
- `languageModelProxy`
- `LanguageModelThinkingPart`

## Debugging

If InfiniAI models do not appear:

1. Run `@infiniai /doctor`.
2. Check the `InfiniAI` output channel.
3. Confirm that the correct plan key is stored with `infiniai.setApikey`.
4. Check `infiniai.modelDiscoveryUrl` and route overrides.
5. Run `Developer: Reload Window` and retry model discovery.

## Troubleshooting

### Upgrade From An Older Version

VS Code may leave older extension version folders on disk, but it scans installed extensions by identifier and loads the latest valid version. Old proposed API files or old source files should not affect this release because the VSIX packages only compiled runtime files from `out/`.

Persistent VS Code state can still affect upgraded installs:

- API keys in Secret Storage are preserved: `infiniai.apiKey` and `infiniai.codingApiKey`.
- User/workspace settings are preserved, including `infiniai.plan`, base URLs, `infiniai.modelDiscoveryUrl`, and `infiniai.modelRoutes`.
- Already-open windows may keep the old extension host running until reload.

After upgrading, run:

```text
@infiniai /doctor
@infiniai /models refresh
```

If the diagnostics show an unexpected endpoint, plan, or route override, reset the corresponding `infiniai.*` setting and reload the window.

### No Models Appear

Check these in order:

1. Run `InfiniAI: Set InfiniAI API Key` and confirm the key is stored for the active plan.
2. Run `@infiniai /doctor` and verify the active plan, key presence, discovery endpoint, and last error.
3. Clear `infiniai.modelDiscoveryUrl` unless you intentionally use a custom discovery endpoint.
4. Temporarily clear `infiniai.modelRoutes` to rule out a bad route override.
5. Run `Developer: Reload Window`, then `@infiniai /models refresh`.

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
