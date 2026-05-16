# InfiniAI `list-models.json` Metadata Analysis

Date: 2026-05-16

Source file: `reports/list-models.json`

## Executive Summary

`reports/list-models.json` is a static InfiniAI catalog snapshot, not runtime data that the extension can fetch when it is running. Treat it as an offline input for periodically regenerating candidate built-in metadata.

It is also not the plain OpenAI-compatible `/v1/models` shape that the extension currently expects. It has this catalog response shape:

```json
{
  "code": 0,
  "msg": "Success",
  "data": {
    "model_list": [...],
    "result_total": 52
  }
}
```

The catalog contains 52 models and carries much richer metadata than the current extension consumes. The extension can extract enough metadata to improve:

- model picker names and hover text
- context and output token limits
- tool-calling capability
- image-input capability
- model family classification
- route selection between OpenAI-compatible and Anthropic/Claude-compatible endpoints
- hidden filtering for non-chat models such as embeddings, rerankers, image generation, and video generation
- diagnostics and model tree details

The runtime extension should not depend on this file. Instead, use a local repo utility to parse the static snapshot and produce reviewable generated metadata. A later implementation PR can decide which generated fields should become bundled extension data.

The current runtime API parser still matters for live InfiniAI `/v1/models` responses, but this static catalog snapshot should be handled by an offline tool, not by trying to fetch `reports/list-models.json` from the extension.

## Offline Utility

Use:

```sh
npm run catalog:normalize
```

This runs:

```sh
node scripts/normalize-infiniai-catalog.mjs \
  --input reports/list-models.json \
  --output reports/infiniai-model-metadata.generated.json \
  --ts-output src/generated/infiniaiCatalogMetadata.generated.ts
```

The report JSON is intentionally placed under `reports/` first for review. The generated TypeScript file under `src/generated/` is the curated built-in runtime subset that the extension can import.

Recommended workflow:

1. Replace or add a fresh static catalog snapshot under `reports/`.
2. Run `npm run catalog:normalize`.
3. Inspect the generated counts and diff.
4. Review `src/generated/infiniaiCatalogMetadata.generated.ts` before shipping.
5. Keep runtime fetching limited to actual InfiniAI API responses; do not make the extension read `reports/list-models.json`.

## Catalog Shape

Every entry in `data.model_list` has the same top-level keys:

| Field | Present | Non-empty | Type(s) | Usefulness |
| --- | ---: | ---: | --- | --- |
| `maas_model_id` | 52 | 52 | string | Internal stable catalog ID; good for diagnostics, not VS Code model ID. |
| `name` | 52 | 52 | string | Best VS Code `id`; also safe fallback display name. |
| `display_name` | 52 | 52 | string | Best VS Code `name`; usually equals `name`, but one model differs. |
| `model_type` | 52 | 0 | string | Not useful in this snapshot. Use `tag_list` type tag instead. |
| `default_gpu_name` | 52 | 52 | string | Currently always `NVIDIA`; useful only for tooltip/diagnostics. |
| `tag_list` | 52 | 52 | array | Most valuable metadata source. |
| `description` | 52 | 49 | string | Mixed quality; use cautiously in tooltip. |
| `release_time` | 52 | 52 | string | Good VS Code `version` candidate, sorting, and tooltip. |
| `context_length` | 52 | 52 | number | Good VS Code `maxInputTokens` source after subtracting output limit. |
| `max_completion_tokens` | 52 | 28 | number/null | Good VS Code `maxOutputTokens` source when present. |
| `access_type` | 52 | 52 | number | Unknown semantics; keep in `extra` and diagnostics. |
| `promotion` | 52 | 30 | string | Good tooltip/detail badge when non-empty. |
| `model_pictures` | 52 | 52 | array | Not useful for VS Code language model UI. |
| `manufacturer` | 52 | 51 | string | Useful for tooltip/detail/family inference. |
| `info` | 52 | 0 | string | Not useful in this snapshot. |
| `call_info` | 52 | 52 | object | Pricing/billing text for tooltip; not direct numeric pricing. |
| `call_preparation` | 52 | 0 | string | Not useful in this snapshot. |
| `call_demo` | 52 | 0 | null | Not useful. |
| `product_llm_concurrency_list` | 52 | 0 | null | Not useful. |
| `product_llm_concurrency_status` | 52 | 0 | string | Not useful in this snapshot. |
| `concurrency_product_info` | 52 | 52 | object | All observed prices are `0`; keep out of UI unless semantics are confirmed. |

## Model Type Coverage

The real model type is encoded as a `tag_list` item with `tag_type: "type"`.

| Type tag | Count | Extension treatment |
| --- | ---: | --- |
| `大语言模型` | 37 | Chat model candidate. |
| `多模态模型` | 6 | Chat model candidate with possible image input. |
| `向量模型` | 3 | Not a VS Code chat provider model; hide from chat picker. |
| `重排序模型` | 1 | Not a VS Code chat provider model; hide from chat picker. |
| `生图大模型` | 2 | Not a VS Code chat provider model; hide from chat picker. |
| `视频大模型` | 3 | Not a VS Code chat provider model; hide from chat picker. |

Recommended default chat filter:

```ts
const chatTypes = new Set(["大语言模型", "多模态模型"]);
```

This yields 43 chat-capable model candidates from the 52 catalog entries.

## Scene Tag Coverage

The `scene` tags are the best capability source:

| Scene tag | Count | Suggested extension usage |
| --- | ---: | --- |
| `文本生成` | 37 | Chat/text-generation candidate signal. |
| `工具调用` | 28 | Set `capabilities.toolCalling = true`. |
| `深度推理` | 23 | Mark as reasoning-capable in `extra`; optionally add tooltip/detail text. |
| `代码生成` | 15 | Mark as code-friendly in `extra`; optionally add tooltip/detail text. |
| `视觉理解` | 7 | Set `capabilities.imageInput = true` and/or `vision = true`. |
| `文本向量` | 5 | Embedding signal; exclude from chat model picker unless explicitly supported elsewhere. |
| `视频生成` | 3 | Exclude from chat provider. |
| `文生视频` | 3 | Exclude from chat provider. |
| `图生视频` | 3 | Exclude from chat provider. |
| `基于首帧` | 2 | Video-specific; exclude from chat provider. |
| `图像生成` | 2 | Image generation; exclude from chat provider. |

## Endpoint Type Coverage

17 models carry `tag_type: "endpoint_type"` with `tag_name: "Claude兼容"`.

This is a strong route hint. It should map to:

```ts
apiMode: "anthropic"
endpointKind: "messages"
```

Affected models:

- `deepseek-v3.2`
- `deepseek-v3.2-thinking`
- `deepseek-v4-flash`
- `deepseek-v4-pro`
- `glm-4.5`
- `glm-4.5-air`
- `glm-4.6`
- `glm-4.7`
- `glm-5`
- `glm-5.1`
- `kimi-k2.5`
- `kimi-k2.6`
- `mimo-v2-pro`
- `mimo-v2.5-pro`
- `minimax-m2.1`
- `minimax-m2.5`
- `minimax-m2.7`

This is better than inferring Anthropic transport from `family`; `family` should remain model lineage, not endpoint shape.

## Stable VS Code Metadata Mapping

Recommended mapping from catalog entry to stable `LanguageModelChatInformation`:

| VS Code field | Catalog source | Notes |
| --- | --- | --- |
| `id` | `name` | Use the request model ID. |
| `name` | `display_name || name` | Better model picker label. |
| `family` | derived from `name`/`manufacturer` | Use lineage such as `deepseek-v4`, `qwen3`, `glm-5`, `kimi-k2`, `mimo-v2`, `minimax-m2`, `gpt-oss`, not endpoint kind. |
| `tooltip` | composed from manufacturer, type, scenes, promotion, context/output, endpoint, billing | Avoid low-quality descriptions like `test`, `tet`, `转发`. |
| `detail` | compact provider/capability detail | Example: `DeepSeek · Tools · Reasoning · Claude-compatible`. |
| `version` | `release_time` | Prefer ISO date or timestamp string. |
| `maxInputTokens` | `context_length - maxOutputTokens` | Clamp to at least 1. |
| `maxOutputTokens` | `max_completion_tokens || fallback` | Do not ignore `max_completion_tokens`. |
| `capabilities.toolCalling` | scene tag `工具调用` | More accurate than current `!id.includes("embed")`. |
| `capabilities.imageInput` | scene tag `视觉理解` or type `多模态模型` | More accurate than current suffix heuristics. |

Recommended additions to internal `InfiniAIModelInfo`:

```ts
interface InfiniAICatalogModelInfo extends InfiniAIModelInfo {
  maasModelId?: string;
  displayName?: string;
  manufacturer?: string;
  description?: string;
  promotion?: string;
  releaseTime?: string;
  catalogType?: string;
  scenes?: string[];
  endpointType?: string;
  sizeLabel?: string;
  gpu?: string;
  billing?: {
    expenses?: string;
    billingMethod?: string;
    billingCycle?: string;
    usageStatistics?: boolean;
  };
}
```

## Current Extension Gaps

### 1. Parser does not accept this response shape

Current `fetchModels` recognizes:

- `{ data: [...] }`
- `{ data: { data: [...] } }`

It does not recognize:

- `{ data: { model_list: [...], result_total: 52 } }`

Add a third parser branch and normalize catalog entries into the extension's internal model shape.

### 2. Output token limit is currently missed

The catalog uses `max_completion_tokens`, but `InfiniAIModelInfo` only has `max_tokens`, and `toLanguageModelInfo` reads `model.max_tokens`.

Result: 28 models with real output limits would currently fall back to `DEFAULT_MAX_TOKENS`.

### 3. Model picker labels are worse than necessary

Current code uses:

```ts
name: model.id
tooltip: `InfiniAI Model ${model.id}`
detail: `InfiniAI ${route.transport}`
```

The catalog can provide a much better picker experience:

```ts
name: model.displayName ?? model.id
tooltip: buildCatalogTooltip(model, route)
detail: buildCatalogDetail(model, route)
```

### 4. Tool-calling is currently over-enabled

Current code sets:

```ts
toolCalling: !model.id.includes("embed") && !model.id.includes("reranker")
```

The catalog has a real `工具调用` tag. Use it. This avoids advertising tool support for text-only or unsupported chat models.

### 5. Vision support can be exact

Current code uses explicit metadata if available, then ID heuristics. The catalog gives an exact `视觉理解` tag for 7 models:

- `deepseek-ocr-2`
- `glm-4.5v`
- `glm-4.6v`
- `kimi-k2.5`
- `kimi-k2.6`
- `qwen3-vl-235b-a22b-instruct`
- `qwen3-vl-235b-a22b-thinking`

Normalize this into `vision: true` or `input_modalities: ["text", "image"]`.

### 6. Non-chat models should be hidden from Language Model Chat

Nine entries are not chat models:

- embeddings: `bge-m3`, `jina-embeddings-v2-base-code`, `jina-embeddings-v2-base-zh`
- reranker: `bge-reranker-v2-m3`
- image generation: `doubao-seedream-4-0-250828`, `doubao-seedream-5-0-260128`
- video generation: `hailuo`, `seedance-1.0`, `vidu`

They should not be returned as `LanguageModelChatInformation` unless the extension later adds separate non-chat surfaces.

## Recommended Normalization Rules

### Catalog Entry to Internal Model

```ts
function normalizeCatalogModel(raw: CatalogModel): InfiniAICatalogModelInfo | undefined {
  const tags = indexTags(raw.tag_list);
  const type = firstTag(tags, "type");
  const scenes = tags.scene ?? [];
  const endpointType = firstTag(tags, "endpoint_type");
  const provider = firstTag(tags, "provider");

  if (!["大语言模型", "多模态模型"].includes(type ?? "")) {
    return undefined;
  }

  const isClaudeCompatible = endpointType === "Claude兼容";
  const maxOutput = typeof raw.max_completion_tokens === "number"
    ? raw.max_completion_tokens
    : undefined;

  return {
    id: raw.name,
    object: "model",
    created: Date.parse(raw.release_time) ? Math.floor(Date.parse(raw.release_time) / 1000) : 0,
    owned_by: raw.manufacturer || provider || "InfiniAI",
    displayName: raw.display_name || raw.name,
    family: inferFamily(raw.name, raw.manufacturer),
    apiMode: isClaudeCompatible ? "anthropic" : "openai",
    endpointKind: isClaudeCompatible ? "messages" : "chat.completions",
    context_length: raw.context_length || undefined,
    max_tokens: maxOutput,
    vision: scenes.includes("视觉理解"),
    input_modalities: scenes.includes("视觉理解") ? ["text", "image"] : ["text"],
    extra: {
      maasModelId: raw.maas_model_id,
      catalogType: type,
      scenes,
      endpointType,
      provider,
      promotion: raw.promotion || undefined,
      description: raw.description || undefined,
      billing: raw.call_info,
    },
  };
}
```

### Family Inference

Suggested deterministic families:

| Name pattern | Family |
| --- | --- |
| `deepseek-v4-*` | `deepseek-v4` |
| `deepseek-v3.2*` | `deepseek-v3.2` |
| `deepseek-v3.1*` | `deepseek-v3.1` |
| `deepseek-r1*`, `pro-deepseek-r1` | `deepseek-r1` |
| `glm-5*` | `glm-5` |
| `glm-4.7*` | `glm-4.7` |
| `glm-4.6*` | `glm-4.6` |
| `glm-4.5*` | `glm-4.5` |
| `kimi-k2*` | `kimi-k2` |
| `mimo-v2.5*` | `mimo-v2.5` |
| `mimo-v2*` | `mimo-v2` |
| `minimax-m2*` | `minimax-m2` |
| `qwen3-vl*` | `qwen3-vl` |
| `qwen3-next*` | `qwen3-next` |
| `qwen3-coder*` | `qwen3-coder` |
| `qwen3-*` | `qwen3` |
| `gpt-oss*` | `gpt-oss` |
| `baichuan-m2*` | `baichuan-m2` |
| fallback | first two meaningful name segments |

Do not use `chat.completions` or `messages` as `family`. That field is user-visible in some VS Code prompt hovers and is used for selector matching.

## PR Recommendation

Create a PR for catalog normalization before model picker polish:

1. Add catalog response parsing in `fetchModels`.
2. Add a pure `normalizeInfiniAICatalogModel` helper with unit tests using selected fixtures from `reports/list-models.json`.
3. Extend `InfiniAIModelInfo` with normalized optional fields or add a new catalog-aware internal type.
4. Use `displayName`, `manufacturer`, `promotion`, `scenes`, `endpointType`, `context_length`, and `max_completion_tokens` in `toLanguageModelInfo`.
5. Filter non-chat catalog entries out of the VS Code LM provider.
6. Replace the current tool-calling and image-input heuristics with catalog metadata when present, keeping user overrides as the final authority for image input.

## Validation Checklist

- `jq '.data.model_list | length' reports/list-models.json` returns `52`.
- Unit test: parser returns 52 raw catalog entries.
- Unit test: normalized chat model list returns 43 entries.
- Unit test: non-chat models are excluded from `LanguageModelChatInformation`.
- Unit test: 28 models with `工具调用` set `capabilities.toolCalling = true`.
- Unit test: 7 models with `视觉理解` set `capabilities.imageInput = true`.
- Unit test: 17 `Claude兼容` models route to Anthropic/messages.
- Unit test: `deepseek-v4-pro` gets `maxOutputTokens = 393216`, not the default.
- Extension Development Host smoke test: model picker shows display names, useful detail, and no embedding/reranker/video/image-generation entries.
