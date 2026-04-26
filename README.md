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

## Contributing

Issues and pull requests are welcome:

- [GitHub Issues](https://github.com/drewzhao/infini-ai-copilot/issues)

See [CONTRIBUTE.md](CONTRIBUTE.md) for architecture and release guardrails.

## License

[MIT License](LICENSE)
