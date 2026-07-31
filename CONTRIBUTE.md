# Contributing Guide

This extension targets VS Code `^1.130.0` and uses stable VS Code APIs only. Do not add Copilot private APIs, proposed API shims, or standalone Copilot Chat extension dependencies.

## Development Setup

Use npm only:

```bash
npm ci
npm run lint
npx prettier --check .
npm run compile
npm test
npm run build
```

Do not add `pnpm-lock.yaml`, `yarn.lock`, or generated proposed API files.

## Architecture

Primary runtime surfaces:

- `src/extension.ts`: activation, command registration, provider registration, participant registration, logging, and invalidation wiring.
- `src/provider.ts`: VS Code `LanguageModelChatProvider`, model registry cache, request dispatch, diagnostics helpers, cancellation propagation, and retry integration.
- `src/modelCapabilities.ts`: API, extension-policy, and user-override capability resolution.
- `src/agentEligibility.ts`: pure exact-ID Agent eligibility override handling used by the Models view.
- `src/grayLanguageModelMetadata.ts`: centralized Stable-runtime metadata bridge for picker controls and Agents/BYOK.
- `src/participant.ts`: stable `@infiniai` diagnostics participant with `/doctor`, `/models`, and `/test`.
- `src/route.ts`: metadata-driven route resolution for OpenAI, Anthropic, and Vertex transports.
- `src/sse.ts`: shared cancellation-aware SSE reader.
- `src/openai`, `src/anthropic`, `src/vertex`: provider-specific request conversion and stream adaptation.

The extension has four user-facing surfaces:

1. A language model provider registered as `infiniai`.
2. A diagnostic chat participant registered as `@infiniai`.
3. An InfiniAI Models tree for discovery status, provider visibility, Agent eligibility, and route controls.
4. A local usage dashboard with CSV export and confirmed reset.

The participant is not a general assistant. Keep it focused on diagnostics, model inventory, and minimal route health checks.

## Stable API Guardrails

Do not add or reintroduce:

- `enabledApiProposals`
- `src/vscode.proposed.*.d.ts`
- `.vscode/launch.json` proposed API flags
- `github.copilot-chat` as an extension dependency
- Copilot private commands, extension IDs, or RPC channels
- `chatParticipantAdditions`
- `defaultChatParticipant`
- `languageModelProxy`
- `targetChatSessionType`
- `requiresAuthorization`
- `isDefault`
- `editTools`

Use the stable APIs exposed by the installed VS Code engine target:

- `vscode.lm.registerLanguageModelChatProvider`
- `vscode.chat.createChatParticipant`
- `vscode.window.createOutputChannel(..., { log: true })`
- `vscode.SecretStorage`
- `vscode.CancellationToken` / `vscode.CancellationError`

The extension centralizes the audited, Stable-runtime-accepted `isBYOK`, `isUserSelectable`, `statusIcon`,
`configurationSchema`, and `modelConfiguration` surfaces in `src/grayLanguageModelMetadata.ts`. Do not write these
fields elsewhere, declare a proposal for them, or assume they are part of the public stable declaration. The optional
`LanguageModelThinkingPart` constructor is runtime-detected without a manifest proposal and is not required for replay
correctness. Run `npm run validate:stable-gray` after any related change.

## Routing Rules

Model routing precedence is:

1. User `infiniai.modelRoutes` pattern match.
2. Provider-owned route preferences for compatibility-sensitive model families.
3. Explicit model metadata from InfiniAI discovery.
4. Provider-owned catalog metadata.
5. Conservative OpenAI-compatible fallback.

Supported transports:

- `openai`: `/chat/completions`
- `anthropic`: `/v1/messages`
- `vertex`: `:streamGenerateContent`

If a model family requires an unimplemented endpoint shape, fail with a clear provider error. Do not silently coerce it into another protocol.

## Logging Rules

Use the shared log helpers from `src/utils.ts`. Logs must not include:

- API keys
- auth headers
- prompts
- tool results
- image data URLs
- full request or response bodies

Prefer structured operational details: request id, model id, transport, endpoint host/path, HTTP status, retry attempt, elapsed time, streamed bytes, and finish reason.

## Cancellation And Retry Rules

All provider network calls must accept a VS Code `CancellationToken` and pass it through an `AbortController`.

Retry only:

- network failures before streaming starts
- HTTP `408`, `429`, `500`, `502`, `503`, `504`

Do not retry after any response part has streamed. Respect `Retry-After` when present. Treat `max_attempts` as the total number of attempts, not the number of retries.

## Tests

Add or update tests when changing:

- retry behavior
- model discovery cache keys, TTL, dedupe, or invalidation
- route resolution
- SSE parsing or stream finalization
- provider-specific message conversion
- participant command output
- cancellation behavior
- Agent eligibility precedence, exact/wildcard overrides, or capability provenance

Useful focused commands:

```bash
npm test -- --grep "retry|executeWithRetry"
npm test -- --grep "model discovery|cache|invalidation"
npm test -- --grep "cancellation|AbortController"
npm test -- --grep "SSE|tool call|flush"
npm test -- --grep "routing|OpenAI|Anthropic|Vertex"
npm test -- --grep "chat participant|doctor|models|test"
```

## Release Checklist

Before publishing:

1. Confirm `package.json` and `package-lock.json` versions match the release.
2. Run the full npm verification sequence.
3. Run `npm run validate:stable-gray` against the target VS Code Stable installation and source checkout.
4. Build the VSIX with `npm run build`.
5. Inspect package contents:

```bash
release_version=$(node -p 'require("./package.json").version')
npx @vscode/vsce ls --packagePath "infiniai-copilot-${release_version}.vsix"
shasum -a 256 "infiniai-copilot-${release_version}.vsix"
```

6. Keep the previous VSIX archived for rollback.
7. Publish rollback fixes as a new patch release. Do not assume an older Marketplace version can be republished.
