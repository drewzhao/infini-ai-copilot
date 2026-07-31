# InfiniAI Live Tool-Calling Audit — 2026-07-31

Endpoint: `https://cloud.infini-ai.com/maas/v1/models`

The authenticated OpenAI-compatible model list returned 93 rows. All 93 rows omitted `capabilities`, so the live API
provided no `toolCalling` signal. Non-chat image, video, embedding, and reranking rows remain outside the extension's
chat-model selection path.

The repository's Chat Completions agent-compat probe screened 29 well-known public chat model IDs. A model was added to
the verified fallback list only after both of these checks passed against the InfiniAI endpoint:

1. a required function tool call with validated JSON arguments;
2. assistant `tool_calls` replay followed by a `tool` result and a successful continuation.

New exact verified IDs:

- `deepseek-v3`
- `glm-4.5-air`
- `gpt-oss-120b`
- `gpt-5.4`
- `claude-haiku-4-5-20251001`
- `gemini-3.1-flash-lite-preview`
- `minimax-m2.7`
- `minimax-m3`

Models that failed, returned transient errors without a successful bounded retry, or rejected the probe's required-tool
shape remain Automatic/unknown. A well-known upstream family name was not treated as sufficient evidence for the
InfiniAI route.

Separately from probe verification, the extension applies an explicit family policy that advertises every `claude-*`
model as Agent-capable when the API is silent. This policy makes all current Claude catalog entries selectable in Agent
model pickers; an explicit negative API value or `infiniai.disableToolCallingModels` still disables eligibility.

Local redacted probe artifacts were written under `/tmp/infiniai-agent-compat-*-20260731` and were not added to the
repository.
