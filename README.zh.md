# InfiniAI Provider for VS Code

InfiniAI Provider for VS Code 将 InfiniAI 注册为稳定的 VS Code 语言模型提供方，并提供 `@infiniai` 诊断参与者。核心提供方路径使用稳定的 VS Code API，不依赖独立的 `github.copilot-chat` 扩展，也不使用 Copilot 私有 API。Marketplace 清单不声明 proposed API 依赖;可选的 `LanguageModelThinkingPart` 运行时探测不是 `reasoning_content` 回放正确性的前提。

## 使用方式

1. 从 [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=drewzhao.infiniai-copilot) 安装扩展。
2. 打开 VS Code Chat，并使用模型选择器。
3. 选择 **Manage Models...**，然后添加 **InfiniAI** 提供方的模型。
4. 首次使用时选择 Standard 或 Coding 方案。
5. 输入对应方案的 InfiniAI API Key。密钥会保存在 VS Code Secret Storage 中。
6. 在模型选择器中选择 InfiniAI 模型。

思考回放会按模型族 profile 解析。内置 round-trip 默认值已经包含 MiMo V2、DeepSeek V4、精确 `deepseek-r1`、精确 `deepseek-v3.2-thinking`、GLM 5/4.7、Kimi K2 和 MiniMax 模式，所以新的工具调用聊天可以默认保留 thinking；如果回放上下文过期或缺失，扩展仍会先在本地失败，避免发送不安全的上游请求。MiniMax 模型始终会用 `reasoning_split: true` 请求 split reasoning，并回放原生 `reasoning_details`。修改 round-trip 列表后，请从新聊天开始。

Kimi K2 默认走 OpenAI 兼容 Chat Completions 路由，这样 preserved thinking 使用已验证的 `thinking.keep` 与
`reasoning_content` 形态。如果你手动把 Kimi K2 切到 Anthropic Messages，扩展会使用保守 safe-off profile：
发送 `thinking: { "type": "disabled" }`，并且不会在该传输协议上套用 Kimi 的 round-trip 默认值。

也可以在 Chat 中使用 `@infiniai` 进行诊断：

- `@infiniai /doctor` 检查配置、密钥是否存在、端点设置、路由覆盖数量、缓存状态以及最近一次脱敏后的提供方错误。
- `@infiniai /models` 列出本地缓存中的模型、有效传输协议、路由来源和路由能力。
- `@infiniai /models refresh` 刷新模型发现结果后再列出模型。
- `@infiniai /test` 选择一个可见的 InfiniAI 模型，并针对它的有效路由执行一个最小的、可取消的健康检查请求。

该参与者只用于诊断，不会替代通用聊天助手。

InfiniAI 活动栏还包含：

- **模型** 树视图，用于切换方案、刷新模型、管理模型选择器可见性，以及按模型切换协议。
- **本地用量** 面板，基于流式响应在本地记录请求用量，支持导出 CSV，并通过 VS Code 原生确认对话框清空记录。

## 使用前提

- VS Code `^1.117.0`
- 有效的 InfiniAI API Key，可从 [infiniai.ai](https://infiniai.ai) 获取
- 本地开发需要 Node.js 和 npm

扩展使用 VS Code 内置的 Chat 与语言模型提供方 API。不需要独立安装 Copilot Chat 扩展。

## 开发

本仓库只使用 npm 作为包管理器。

```bash
npm ci
npm run lint
npx prettier --check .
npm run compile
npm test
npm run catalog:normalize
npm run build
```

`npm run catalog:normalize` 会解析静态快照 `reports/list-models.json`，并重新生成 `src/generated/` 下的内置模型元数据。扩展运行时不会读取或拉取这个文件。

本地运行扩展：

1. 使用 VS Code `1.117+` 打开本仓库。
2. 按 `F5` 启动 Extension Development Host。
3. 在开发主机中通过模型选择器添加 InfiniAI 模型，或运行 `@infiniai /doctor`。

## 激活与日志

扩展保持懒加载。VS Code 会在稳定语言模型提供方、聊天参与者贡献点被使用时自动激活扩展，或在执行 `infiniai.setApikey` 时激活扩展。

日志写入名为 `InfiniAI` 的 VS Code `LogOutputChannel`。扩展会脱敏 API Key、认证头、提示词、工具结果、图片数据和完整响应体。

常见日志字段包括 request id、model id、提供方传输类型、端点 host/path、HTTP 状态码、重试次数、耗时、流式字节数和结束原因。

## 配置

常用设置：

- `infiniai.plan`: 选择 `"standard"` 或 `"coding"`。如果未设置，路由默认按 `"standard"` 处理，交互式密钥录入流程会先提示选择方案。
- `infiniai.baseUrl`: Standard Plan 的 OpenAI 兼容基础 URL。
- `infiniai.anthropic.baseUrl`: Standard Plan 的 Anthropic 兼容基础 URL。
- `infiniai.coding.baseUrl`: Coding Plan 的 OpenAI 兼容基础 URL。
- `infiniai.coding.anthropic.baseUrl`: Coding Plan 的 Anthropic 兼容基础 URL。
- `infiniai.modelDiscoveryUrl`: 可选的模型发现绝对 URL。为空时使用当前 InfiniAI 方案默认值。
- `infiniai.modelCacheTtlMs`: 模型发现缓存 TTL，单位毫秒。设为 `0` 表示每次请求都刷新。
- `infiniai.modelRoutes`: 可选模型路由覆盖。每项支持 `pattern`、`transport`（`"openai"`、`"anthropic"` 或 `"vertex"`）以及可选 `baseUrl`。**InfiniAI: Switch Model Protocol** 命令是编辑精确 OpenAI/Anthropic 单模型覆盖的更安全入口。
- `infiniai.imageInputModels`: 为匹配的模型 ID 强制启用图片输入能力。支持 `*` 通配符。
- `infiniai.disableImageInputModels`: 为匹配的模型 ID 强制禁用图片输入能力。支持 `*` 通配符。
- `infiniai.disableThinkingForModels`: 安全列表。匹配的模型 ID 默认关闭思考模式，以避免已知的 `reasoning_content` HTTP 400 错误。内置默认值包含已知 Xiaomi MiMo V2 模型 ID 与 DeepSeek V4 系列：`mimo-v2-pro`、`mimo-v2.5-pro`、`mimo-v2.5`、`mimo-v2-omni`、`mimo-v2-flash`、`deepseek-v4*`。详见下方[为思考模型避免 HTTP 400](#为思考模型避免-http-400)。
- `infiniai.enableThinkingRoundTripForModels`: round-trip 回放模型族列表。内置默认值是 `mimo-v2*`、`deepseek-v4*`、精确 `deepseek-r1`、精确 `deepseek-v3.2-thinking`、`glm-5*`、`glm-4.7*`、`kimi-k2*` 和 `minimax*`；用户模式会追加到该列表。基础 `deepseek-v3.2` 默认不加入，因为它默认不思考。已知适配器会保留提供方原生形态：MiMo V2、DeepSeek V4、DeepSeek R1、GLM、Kimi、Qwen 使用 OpenAI `reasoning_content`；MiniMax split 模式使用 OpenAI `reasoning_details`；Anthropic Messages 路由使用 Anthropic `thinking` block。Kimi K2 的内置默认只应用在 OpenAI 兼容路由；手动 Anthropic 路由的 Kimi 会使用 safe-off profile。若回放数据缺失、过期、冲突或不可用，扩展会在本地失败以避免 HTTP 400。支持 `*` 通配符。
- `infiniai.thinkingReplayStore`: profile 自动启用或显式启用后的思考回放存储后端。默认 `"localPlaintext"`，以支持重启后继续对话；设为 `"memory"` 则不把回放数据写入磁盘，但不支持重启后继续对话。
- `infiniai.retry`: 可重试网络错误和 HTTP 错误的重试策略。
- `infiniai.delay`: 请求之间的固定延迟，单位毫秒。

## 模型选择器控制项

扩展会在 VS Code 模型选择器中提供稳定安全的模型控制项：

- **Max output tokens** 限制回复最多生成的 token 数。选择模型默认值时不会发送上限。
- **Reasoning effort** 只会出现在已确认存在 effort 参数的 profile 上。`Unset` 不发送 effort。OpenAI 兼容 DeepSeek V4 会映射到 `reasoning_effort`；Anthropic 路由的 DeepSeek profile 会映射到 `output_config.effort`。
- **Thinking mode** 只会出现在已确认存在当前轮 thinking 控制参数的模型 profile 上。它提供 `Unset`，以及该 profile 支持的 `Disabled` 和/或 `Enabled` 选项。Qwen 映射到 `enable_thinking`，OpenAI 兼容 GLM/Kimi/MiMo/DeepSeek V4 映射到 `thinking.type`，Anthropic DeepSeek 映射到 Anthropic `thinking` 对象。手动 Anthropic 路由的 Kimi 只展示安全的 `Disabled` 选项。DeepSeek R1 和 MiniMax 不暴露禁用/启用开关，因为尚未确认可靠的禁用字段。

Vertex 路由会把最大输出 token 映射到 `generationConfig.maxOutputTokens`。

这些控制项使用 VS Code Stable 当前运行时接受的模型配置表面，不需要在扩展清单中声明 proposed API。

## 路由与协议切换

路由优先级：

1. 用户配置的 `infiniai.modelRoutes` 模式匹配。
2. 提供方维护的路由偏好，例如 Kimi K2 默认使用 OpenAI 兼容路由。
3. InfiniAI 模型元数据中的显式信息。
4. 提供方维护的模型目录元数据。
5. 保守回退到 OpenAI 兼容路由。

传输行为：

- OpenAI 兼容路由调用 `/chat/completions`。
- Anthropic 路由调用 `/v1/messages`，并使用 `x-api-key` 和 `anthropic-version`。
- Vertex 路由通过 Vertex 适配器调用 `:streamGenerateContent`。

未实现的 endpoint family 会明确失败，不会静默回退。

对于 Claude 兼容的 InfiniAI 模型，可以从命令面板或 InfiniAI 模型树行中运行 **InfiniAI: Switch Model Protocol**。该命令会：

- 只暴露 **OpenAI Chat Completions** 和 **Anthropic Messages** 两种选择。
- 向全局 `infiniai.modelRoutes` 写入精确 `{ pattern: modelId, transport }` 覆盖。
- 把精确覆盖放在更宽泛的通配符规则之前，并移除重复的精确规则。
- 对 UI 创建的精确覆盖移除旧 `baseUrl`，避免协议切换后仍使用不匹配的端点。
- 当已有精确覆盖时提供 **Reset exact override**。重置只删除该精确项；之后会在确认信息中展示匹配的通配符或目录/默认路由。

模型树 tooltip 会展示有效传输协议、路由来源（`user`、`metadata`、`catalog` 或 `heuristic`）、endpoint kind、模型选择器可见性和核心能力。`@infiniai /models` 包含 route source 列，`@infiniai /doctor` 会报告总路由覆盖数量和精确单模型覆盖数量。

## 为思考模型避免 HTTP 400

当你使用思考模型进行工具调用对话时，先使用默认安全策略。只有在需要保留思考质量，并且能接受回放失败时本地中断的情况下，才把受保护或高级模型加入 `infiniai.enableThinkingRoundTripForModels`。

一些模型会在常规回复之外返回提供方私有的推理内容。只要对话中出现工具调用，后续轮次就必须按同一个提供方原生形态回传上一轮推理内容。如果缺失，上游可能返回：

```
HTTP 400 — reasoning_content is required when the previous assistant message contains tool calls
```

VS Code 稳定版语言模型 API (`vscode.LanguageModelChatMessage`) 没有公开的思考/推理内容 part 类型。扩展因此不能只依赖 VS Code 聊天历史来恢复推理上下文。Marketplace 构建不声明 `enabledApiProposals`；稳定版和 Insiders 上的回放正确性都由扩展自有 replay store 负责。

回放是按模型族处理的，不是一个扁平的 `reasoning_content` 开关：

- OpenAI 兼容的 MiMo V2、DeepSeek V4、DeepSeek R1、GLM、Kimi、Qwen profile 会回放 `assistant.reasoning_content`。
- GLM 保持思考状态时会写入 `thinking.clear_thinking: false`，Kimi 会写入 `thinking.keep: true`，Qwen 会写入 `preserve_thinking: true`。
- MiniMax split profile 会始终发送 `reasoning_split: true`，捕获流式 `reasoning_details`，并在启用 round-trip replay 后回放 `assistant.reasoning_details`。
- Anthropic Messages 路由会捕获并回放 `thinking` block；如果上游返回 signature，也会一起保存和回放，并插入到上一条 assistant `tool_use` block 之前。

### 保持默认安全策略

默认情况下，扩展仍会对已知默认不安全的模型 ID/系列强制关闭思考模式，以避免开箱即遇到上述 400 错误。请求体会写入该 profile 支持的禁用参数。对于内置 MiMo V2 与 DeepSeek V4 安全默认值，请求体是：

```jsonc
{
  "thinking": { "type": "disabled" }
}
```

内置安全默认名单包括：`mimo-v2-pro`、`mimo-v2.5-pro`、`mimo-v2.5`、`mimo-v2-omni`、`mimo-v2-flash`（已知 Xiaomi MiMo V2 模型 ID），以及 `deepseek-v4*`（任意 DeepSeek V4 变体）。

这会牺牲这些特定模型的思考质量，但工具调用与普通回复仍正常工作。其他模型（Kimi K2 Thinking、DeepSeek R1、DeepSeek V3.x、Qwen、GLM 等）不受影响，思考模式照常可用。

普通用户通常不需要改动 `infiniai.disableThinkingForModels`。只有当另一个模型出现相同的 `reasoning_content` 400 问题时，才向该设置添加模式，例如 `"my-thinker-*"`。用户模式是追加项，不会移除内置安全默认值。

### 为指定模型尝试思考回放

`infiniai.enableThinkingRoundTripForModels` 已经为已验证的回放族预置：`"mimo-v2*"`、`"deepseek-v4*"`、`"deepseek-r1"`、`"deepseek-v3.2-thinking"`、`"glm-5*"`、`"glm-4.7*"`、`"kimi-k2*"` 和 `"minimax*"`。基础 `"deepseek-v3.2"` 默认不加入，因为它默认不思考；Kimi K2 的默认回放只应用在 OpenAI 兼容路由。只有当另一个模型族已经有经过验证的回放适配器时，才向该设置添加模式：

- 如果回放预检确认所需提供方原生推理形态可用，扩展会保持思考开启并发送请求。
- 如果回放数据缺失、过期、冲突或不可用，扩展会在本地失败，不会发送可能触发上游 HTTP 400 的请求。

如果希望已启用的思考工具调用对话在 VS Code 重载或重启后仍能继续，保持 `infiniai.thinkingReplayStore` 默认值 `"localPlaintext"`。只有在不希望回放数据写入磁盘，并且可以接受重启后不能继续这类对话时，才选择 `"memory"`。

运行 `InfiniAI: Clear Thinking Replay Cache` 可清除当前回放缓存。清除后，已有工具调用对话可能无法继续使用思考回放；新对话可以重新建立回放数据。

回放逻辑会按实际传输协议处理：

- OpenAI 兼容路由会捕获流式返回的 `reasoning_content`，并在后续敏感请求前注入到上一条 assistant 消息中。
- MiniMax OpenAI 兼容路由会捕获流式返回的 `reasoning_details`，并在后续敏感请求前作为 `reasoning_details` 注入到上一条 assistant 消息中。
- Anthropic Messages 路由会捕获流式返回的 `thinking` block，包括存在时的 signature，并在上一条 assistant
  `tool_use` block 前注入匹配的 `thinking` block。

因此，对于 `mimo-v2.5-pro` 这类 Claude 兼容 InfiniAI 模型，只要所需回放缓存仍存在，在 OpenAI Chat
Completions 与 Anthropic Messages 之间切换也不会失去回放保护。

## 命令

- `infiniai.setApikey`: 设置、更新或删除 Standard/Coding 方案的 API Key。

聊天参与者命令：

- `@infiniai /doctor`
- `@infiniai /models`
- `@infiniai /models refresh`
- `@infiniai /test`

## 稳定 API 策略

Marketplace 清单不声明任何 `enabledApiProposals`，也不包含 proposed API 启动标志。

提供方使用稳定的 VS Code contribution point，同时使用一小组经过审计、当前 VS Code Stable 运行时接受的稳定灰色表面：

- `isUserSelectable` 让符合条件的 InfiniAI 模型默认出现在模型选择器中。
- `configurationSchema` 提供最大输出 token、reasoning effort 和 thinking mode 等模型选择器控制项。
- 运行时请求选项 `configuration` / `modelConfiguration` 把用户选择的模型控制项传回 provider。

这些字段集中在 `src/grayLanguageModelMetadata.ts`，并由 `npm run validate:stable-gray` 验证。

本扩展刻意避免硬性 proposed API 表面：

- Copilot 私有命令或扩展 ID
- `chatParticipantAdditions`
- `defaultChatParticipant`
- `languageModelProxy`
- `targetChatSessionType`
- `requiresAuthorization`
- `isDefault`
- `editTools`

源码保留了面向开发/自定义宿主的 `LanguageModelThinkingPart` 运行时探测，但 replay 正确性和 HTTP 400 缓解不依赖 proposed API。

## 调试

如果 InfiniAI 模型没有出现：

1. 运行 `@infiniai /doctor`。
2. 查看 `InfiniAI` 输出通道。
3. 通过 `infiniai.setApikey` 确认对应方案的 API Key 已保存。
4. 检查 `infiniai.modelDiscoveryUrl` 和路由覆盖配置。
5. 执行 `Developer: Reload Window` 后重试模型发现。

## 故障排查

### 从旧版本升级

VS Code 可能会在磁盘上保留旧扩展版本目录，但它会按扩展标识扫描已安装扩展，并加载最新的有效版本。旧的 proposed API 文件或旧源码文件不会影响此版本，因为 VSIX 只打包 `out/` 中的编译后运行时代码。

升级后仍会保留的 VS Code 状态可能影响行为：

- Secret Storage 中的 API Key 会保留：`infiniai.apiKey` 和 `infiniai.codingApiKey`。
- 用户/工作区设置会保留，包括 `infiniai.plan`、基础 URL、`infiniai.modelDiscoveryUrl` 和 `infiniai.modelRoutes`。
- 已打开窗口可能继续运行旧的扩展主机，直到重新加载窗口。

升级后建议运行：

```text
@infiniai /doctor
@infiniai /models refresh
```

如果诊断结果显示了意外的端点、方案或路由覆盖，请重置对应的 `infiniai.*` 设置并重新加载窗口。

### 没有模型出现

按以下顺序检查：

1. 运行 `InfiniAI: Set InfiniAI API Key`，确认 API Key 已保存到当前激活的方案。
2. 运行 `@infiniai /doctor`，检查当前方案、密钥是否存在、模型发现端点和最近错误。
3. 清空 `infiniai.modelDiscoveryUrl`，除非您明确需要自定义模型发现端点。
4. 临时清空 `infiniai.modelRoutes`，排除错误路由覆盖的影响。
5. 执行 `Developer: Reload Window`，然后运行 `@infiniai /models refresh`。

### Anthropic 或 Vertex 路由请求失败

路由覆盖会直接决定实际请求形态。如果路由被强制为 `anthropic`，扩展会发送 `/v1/messages`；如果路由被强制为 `vertex`，扩展会发送 `:streamGenerateContent`。请确认配置的 `baseUrl` 与选择的 transport 匹配。

快速隔离问题时，可以删除 `infiniai.modelRoutes` 中匹配的项目，让扩展回退到模型元数据或 OpenAI 兼容路由。

### 需要共享日志

请使用 `InfiniAI` 输出通道，但共享前仍应检查并脱敏。日志设计上会避免记录 API Key、提示词、工具结果、图片数据、认证头和完整响应体，但仍建议检查是否包含组织内部端点名或模型 ID。

## 贡献

欢迎提交 issue 和 pull request：

- [GitHub Issues](https://github.com/drewzhao/infini-ai-copilot/issues)

架构与发布约束请见 [CONTRIBUTE.md](CONTRIBUTE.md)。

## 许可证

[MIT License](LICENSE)
