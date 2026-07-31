# InfiniAI Provider for VS Code

InfiniAI Provider for VS Code 将 InfiniAI 注册为稳定的 VS Code 语言模型提供方，并提供 `@infiniai` 诊断参与者。核心提供方路径使用稳定的 VS Code API，不依赖独立的 `github.copilot-chat` 扩展，也不使用 Copilot 私有 API。Marketplace 清单不声明 proposed API 依赖;可选的 `LanguageModelThinkingPart` 运行时探测不是 `reasoning_content` 回放正确性的前提。

## 文档导航

- [快速开始](#快速开始)
- [提供方分组与 Group Name](#提供方分组与-group-name)
- [API Key 管理](#api-key-管理)
- [配置](#配置)
- [模型控制项与 Agents](#模型选择器控制项)
- [路由与协议切换](#路由与协议切换)
- [思考与回放](#为思考模型避免-http-400)
- [命令参考](#命令参考)
- [故障排查](#故障排查)

## 快速开始

1. 从 [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=drewzhao.infiniai-copilot) 安装扩展。
2. 打开命令面板，在 macOS 上按 `Cmd+Shift+P`，在 Windows/Linux 上按 `Ctrl+Shift+P`，运行 **InfiniAI: Add Provider Group**。阅读 Group Name 说明后选择 **Open Language Models**。
3. 在 Language Models 窗口中选择 **Add Models** > **InfiniAI**。
4. 只使用一个 API Key 时保留默认 **Group Name** `InfiniAI`；使用多个 Key 时输入 `Work`、`Personal` 等用途名称。随后在单独的提示框中输入 InfiniAI API Key。
5. 返回 Chat，从模型选择器中选择 InfiniAI 模型。

InfiniAI 凭据只来自 VS Code 提供方分组。提供方会立即返回缓存模型，并在后台执行模型发现，因此上游
超时或失败不会阻塞 VS Code 的共享提供方队列。需要显式重试时，运行可取消的 **InfiniAI: Refresh
Models**。

### 提供方分组与 Group Name

**Group Name** 是 VS Code 内置的本地标签，用来区分同一个语言模型提供方的多个配置。它不是 InfiniAI
API 字段，不会发送给 InfiniAI，也不会影响请求或 API Key 是否有效。

- 只有一个 API Key 时，保留默认名称 `InfiniAI`。
- 使用多个 Key 时，使用 `Work`、`Personal`、`Team A` 等简短用途名称。名称在 InfiniAI 分组之间必须唯一。
- 不要把 API Key 或其他秘密写入 Group Name；这个标签会显示在 VS Code UI 和非秘密配置中。
- 可通过提供方分组菜单中的 **Rename Group** 修改标签。重命名不会修改 API Key 或上游账户。

VS Code 自己绘制 Group Name 提示框，扩展无法为该弹窗添加说明文字。因此建议先运行 **InfiniAI: Add
Provider Group**；该命令会在打开 Language Models 前解释输入内容和安全注意事项。标准模型选择器会保留
分组与凭据绑定，但 Agents 窗口无法可靠区分两个分组中相同的模型 ID，因此 Agent 场景中同一模型只应
使用一个 InfiniAI 分组。

### API Key 管理

| 目标 | 操作 |
| --- | --- |
| 添加 API Key | 运行 **InfiniAI: Add Provider Group**，然后选择 **Add Models** > **InfiniAI**，输入 Group Name 和 API Key。 |
| 替换 API Key | 打开 InfiniAI 提供方分组菜单，选择 **Update API Key**。 |
| 重命名分组 | 打开分组菜单，选择 **Rename Group**。 |
| 查看非秘密配置 | 选择 **Open in Language Models (JSON)**；API Key 不会显示在该 JSON 中。 |
| 删除 API Key 和分组 | 在分组菜单中选择 **Delete** 并确认。 |
| 完全重置 | 删除分组，再通过 **Add Models** > **InfiniAI** 重新创建。 |

扩展没有单独的设置、删除、退出或重置 API Key 命令。**InfiniAI: Open InfiniAI Settings** 只打开
普通 `infiniai.*` 设置，不能读取或修改提供方分组中的秘密。

### InfiniAI 入口

- **InfiniAI** 活动栏的 **模型** 树用于查看分组状态、刷新模型、控制提供方可见性、配置逐模型 Agent
  可用性和切换协议。
- **本地用量** 面板根据流式响应在本地记录请求用量，支持导出 CSV，并通过 VS Code 原生确认框清空记录。
- `@infiniai /doctor`、`@infiniai /models`、`@infiniai /models refresh` 和 `@infiniai /test` 用于诊断、
  模型清单和最小连通性测试，不会替代通用聊天助手。

## 使用前提

- VS Code `^1.130.0`
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

1. 使用 VS Code `1.130+` 打开本仓库。
2. 按 `F5` 启动 Extension Development Host。
3. 在开发主机中通过模型选择器添加 InfiniAI 模型，或运行 `@infiniai /doctor`。

## 激活与日志

扩展保持懒加载。VS Code 会在稳定语言模型提供方、聊天参与者贡献点被使用时，或打开 InfiniAI
视图和命令时自动激活扩展。

日志写入名为 `InfiniAI` 的 VS Code `LogOutputChannel`。扩展会脱敏 API Key、认证头、提示词、工具结果、图片数据和完整响应体。

常见日志字段包括 request id、model id、提供方传输类型、端点 host/path、HTTP 状态码、重试次数、耗时、流式字节数和结束原因。

## 配置

常用设置：

- `infiniai.baseUrl`: OpenAI 兼容 API 基础 URL。默认值为 `https://cloud.infini-ai.com/maas/v1`。
- `infiniai.anthropic.baseUrl`: Anthropic 兼容 API 基础 URL。默认值为 `https://cloud.infini-ai.com/maas`。
- `infiniai.modelDiscoveryUrl`: 可选的模型发现绝对 URL。为空时使用 `https://cloud.infini-ai.com/maas/v1/models`。
- `infiniai.modelDiscoveryTimeoutMs`: 完整模型发现超时，包括响应体下载与解析。默认 15 秒。
- `infiniai.modelCacheTtlMs`: 模型发现缓存 TTL，单位毫秒。设为 `0` 表示每次请求都刷新。
- `infiniai.modelRoutes`: 可选模型路由覆盖。每项支持 `pattern`、`transport`（`"openai"`、`"anthropic"` 或 `"vertex"`）以及可选 `baseUrl`。**InfiniAI: Switch Model Protocol** 命令是编辑精确 OpenAI/Anthropic 单模型覆盖的更安全入口。
- `infiniai.imageInputModels`: 为匹配的模型 ID 强制启用图片输入能力。支持 `*` 通配符。
- `infiniai.disableImageInputModels`: 为匹配的模型 ID 强制禁用图片输入能力。支持 `*` 通配符。
- `infiniai.toolCallingModels`: 为匹配的模型 ID 强制启用工具调用和 VS Code Agent 可用性。扩展已为通过
  工具调用与工具结果回放探测的精确模型 ID 提供基于证据的默认值，并在 API 未声明能力时默认把所有
  `claude-*` 模型标记为 Agent 可用。精确覆盖建议使用 **InfiniAI: Configure Agent Eligibility**；高级
  通配符可直接编辑此设置。Claude 系列默认值只控制选择器资格，不保证每条 InfiniAI 上游路由当前可用。
- `infiniai.disableToolCallingModels`: 为匹配的模型 ID 强制禁用工具调用和 Agent 可用性，优先级高于
  `infiniai.toolCallingModels`。没有 API、扩展或用户确认的未知模型默认不会被标记为 Agent 可用。
- `infiniai.disableThinkingForModels`: 安全列表。匹配的模型 ID 默认关闭思考模式，以避免已知的 `reasoning_content` HTTP 400 错误。内置默认值包含已知 Xiaomi MiMo V2 模型 ID 与 DeepSeek V4 系列：`mimo-v2-pro`、`mimo-v2.5-pro`、`mimo-v2.5`、`mimo-v2-omni`、`mimo-v2-flash`、`deepseek-v4*`。详见下方[为思考模型避免 HTTP 400](#为思考模型避免-http-400)。
- `infiniai.enableThinkingRoundTripForModels`: round-trip 回放列表。Kimi 默认值使用精确的
  `kimi-k2-thinking`、`kimi-k2.5`、`kimi-k2.6`、`kimi-k2.7-code`、`kimi-k2.7-code-highspeed` 和
  `kimi-k3`；DeepSeek V4 使用精确的 `deepseek-v4-pro` 和 `deepseek-v4-flash`。其他默认值包括
  `mimo-v2*`、精确 `deepseek-r1`、精确 `deepseek-v3.2-thinking`、`glm-5*`、`glm-4.7*` 和
  `minimax*`。用户模式会扩展列表，但模型仍需具有已知回放 profile。已知适配器分别保留 OpenAI
  `reasoning_content`、MiniMax `reasoning_details` 或 Anthropic `thinking` block。强制回放 profile 在
  数据缺失、过期、冲突或不可用时会在本地失败。支持 `*` 通配符。
- `infiniai.thinkingReplayStore`: profile 自动启用或显式启用后的思考回放存储后端。默认 `"localPlaintext"`，以支持重启后继续对话；设为 `"memory"` 则不把回放数据写入磁盘，但不支持重启后继续对话。
- `infiniai.retry`: 可重试网络错误和 HTTP 错误的重试策略。
- `infiniai.delay`: 请求之间的固定延迟，单位毫秒。

## 模型选择器控制项

扩展会在 VS Code 模型选择器中提供稳定安全的模型控制项：

- **Max output tokens** 在 **Manage Models** 中限制回复长度。选择模型默认值时不会发送上限；超过模型当前
  最大值的旧设置会被忽略。
- **Reasoning effort** 只出现在确认支持 effort 参数的 profile 上。Kimi K3 提供 `Low`、`High` 和
  `Max`；OpenAI 兼容 DeepSeek V4 与 GLM-5.2 只提供 `High` 和 `Max`；Anthropic DeepSeek V3.2 保留
  `Low`、`Medium` 和 `High`。
- **Thinking mode** 只出现在确认支持当前轮 thinking 控制的 profile 上。Kimi K2.5/K2.6 提供
  `Enabled`/`Disabled`；K2.7 Code 与 K3 因强制思考而不提供开关。确认的 Claude Opus 4.6/4.7 和
  Sonnet 4.6 使用 adaptive thinking；`claude-sonnet-4-5-20250929` 使用 budgeted extended thinking。

VS Code 在模型发现返回配置 schema 后渲染这些控制项。修改后的值从下一次请求开始生效，不会追溯到
已经发送的请求。Agents 窗口当前不会渲染该 schema；需要非自动值时，请先在普通 **Manage Models**
中保存。

Vertex 路由会把最大输出 token 映射到 `generationConfig.maxOutputTokens`。

这些控制项使用 VS Code Stable 当前运行时接受的模型配置表面，不需要在扩展清单中声明 proposed API。

### Agents 窗口

模型只有在 API 元数据、扩展默认值或用户覆盖确认工具调用能力后，才会被导出到 VS Code Agents 窗口。
API 未声明能力时，扩展默认允许所有 `claude-*` 模型，以及通过工具调用与工具结果回放探测的精确模型
ID。未知模型保持不可用。

从命令面板、模型树工具栏或模型行上下文菜单运行 **InfiniAI: Configure Agent Eligibility**：

- **Automatic (Recommended)** 使用 API 与扩展元数据，包括 `claude-*` 系列策略。
- **Enable for Agent** 为一个精确模型 ID 添加用户启用覆盖。它只能修改声明元数据，不能给上游模型增加
  工具能力。
- **Disable for Agent** 阻止该模型 ID 出现在 Agent 选择器中。

模型树 tooltip 会显示有效来源：API metadata、extension metadata、user enabled、user disabled 或
unknown。覆盖对所有 InfiniAI 分组中的同一模型 ID 生效。命令不会静默改写通配符；如果通配符阻止所选
结果，它会引导用户打开设置。能力更改只在本地重建缓存元数据，不会重新请求模型目录。

VS Code 1.130 Agents-window BYOK bridge 不传递逐模型配置 schema，因此 Agents 选择器中不会显示
InfiniAI 的 thinking、effort 或输出上限控件。它还使用 `vendor/model` 作为选择键，无法可靠区分两个
InfiniAI 分组中的相同模型 ID；Agent 场景应只保留其中一个分组。

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
- GLM 保持思考状态时会写入 `thinking.clear_thinking: false`，Kimi 会写入 `thinking.keep: true`，Qwen 会写入 `preserve_thinking: true`。GLM 5/4.7 在 VS Code compaction 之后采用 best-effort 回放：有缓存就回放 `reasoning_content`，如果 compact 生成的工具调用本身没有推理内容，也允许继续发送，因为 GLM 接受这种形态。
- MiniMax split profile 会始终发送 `reasoning_split: true`，捕获流式 `reasoning_details`，并在启用 round-trip replay 后回放 `assistant.reasoning_details`。
- Anthropic Messages 路由会捕获并回放 `thinking` block；如果上游返回 signature，也会一起保存和回放，并插入到上一条 assistant `tool_use` block 之前。若探针显示 thinking 与工具调用组合不安全，具体 profile 仍会禁用这一路径。

### 保持默认安全策略

默认情况下，扩展仍会对已知默认不安全的模型 ID/系列强制关闭思考模式，以避免开箱即遇到上述 400 错误。请求体会写入该 profile 支持的禁用参数。对于内置 MiMo V2 与 DeepSeek V4 安全默认值，请求体是：

```jsonc
{
  "thinking": { "type": "disabled" }
}
```

内置安全默认名单包括：`mimo-v2-pro`、`mimo-v2.5-pro`、`mimo-v2.5`、`mimo-v2-omni`、`mimo-v2-flash`（已知 Xiaomi MiMo V2 模型 ID），以及 `deepseek-v4*`（任意 DeepSeek V4 变体）。Anthropic 路由的 DeepSeek V4 还会按 profile 保持 safe-off，因为实测 `thinking: enabled` 加工具调用可能返回无效的 Anthropic 工具流。

这会牺牲这些特定模型的思考质量，但工具调用与普通回复仍正常工作。其他模型（Kimi K2 Thinking、DeepSeek R1、DeepSeek V3.x、Qwen、GLM 等）不受影响，思考模式照常可用。

普通用户通常不需要改动 `infiniai.disableThinkingForModels`。只有当另一个模型出现相同的 `reasoning_content` 400 问题时，才向该设置添加模式，例如 `"my-thinker-*"`。用户模式是追加项，不会移除内置安全默认值。

### 为指定模型尝试思考回放

`infiniai.enableThinkingRoundTripForModels` 已经为已验证的回放族预置：`"mimo-v2*"`、`"deepseek-v4*"`、`"deepseek-r1"`、`"deepseek-v3.2-thinking"`、`"glm-5*"`、`"glm-4.7*"`、`"kimi-k2*"` 和 `"minimax*"`。基础 `"deepseek-v3.2"` 默认不加入，因为它默认不思考；Kimi K2 与 DeepSeek V4 的默认回放只应用在 OpenAI 兼容路由，Anthropic 路由的 DeepSeek V4 会保持 safe-off。只有当另一个模型族已经有经过验证的回放适配器时，才向该设置添加模式：

- 如果回放预检确认所需提供方原生推理形态可用，扩展会保持思考开启并发送请求。
- 强制要求回放的 profile 如果回放数据缺失、过期、冲突或不可用，扩展会在本地失败，不会发送可能触发上游 HTTP 400 的请求。GLM 5/4.7 对 compact 后无推理内容的工具调用使用 best-effort 策略，仍会在有缓存时回放推理内容。

如果希望已启用的思考工具调用对话在 VS Code 重载或重启后仍能继续，保持 `infiniai.thinkingReplayStore` 默认值 `"localPlaintext"`。只有在不希望回放数据写入磁盘，并且可以接受重启后不能继续这类对话时，才选择 `"memory"`。

运行 `InfiniAI: Clear Thinking Replay Cache` 可清除当前回放缓存。清除后，已有工具调用对话可能无法继续使用思考回放；新对话可以重新建立回放数据。

回放逻辑会按实际传输协议处理：

- OpenAI 兼容路由会捕获流式返回的 `reasoning_content`，并在后续敏感请求前注入到上一条 assistant 消息中。
- MiniMax OpenAI 兼容路由会捕获流式返回的 `reasoning_details`，并在后续敏感请求前作为 `reasoning_details` 注入到上一条 assistant 消息中。
- Anthropic Messages 路由会捕获流式返回的 `thinking` block，包括存在时的 signature，并在上一条 assistant
  `tool_use` block 前注入匹配的 `thinking` block。

因此，对于 `mimo-v2.5-pro` 这类 Claude 兼容 InfiniAI 模型，只要所需回放缓存仍存在，在 OpenAI Chat
Completions 与 Anthropic Messages 之间切换也不会失去回放保护。

## 命令参考

打开命令面板并输入 `InfiniAI:` 可找到所有扩展命令：

| 命令 | ID | 作用 |
| --- | --- | --- |
| **InfiniAI: Refresh Models** | `infiniai.refreshModels` | 取消当前模型发现，并以可取消进度显式重试所有已解析分组。 |
| **InfiniAI: Exclude InfiniAI Model from Provider List** | `infiniai.hideModel` | 在扩展返回模型给 VS Code 前排除所选模型 ID。 |
| **InfiniAI: Include InfiniAI Model in Provider List** | `infiniai.showModel` | 包含所选模型 ID，并覆盖匹配的隐藏模式。 |
| **InfiniAI: Reset InfiniAI Provider Model Filters** | `infiniai.showAllModels` | 清除显式包含、排除和隐藏模式，使所有已发现模型在提供方层可见。 |
| **InfiniAI: Switch Model Protocol** | `infiniai.switchModelProtocol` | 创建、修改或重置精确模型的 OpenAI/Anthropic 路由覆盖。 |
| **InfiniAI: Configure Agent Eligibility** | `infiniai.configureAgentEligibility` | 把精确模型 ID 设置为 Automatic、Enable for Agent 或 Disable for Agent。 |
| **InfiniAI: Open InfiniAI Settings** | `infiniai.openSettings` | 打开 `infiniai.*` 设置；不管理 API Key。 |
| **InfiniAI: Add Provider Group** | `infiniai.addProviderGroup` | 解释 Group Name 与安全命名，然后打开 Language Models。 |
| **InfiniAI: Open VS Code Manage Models** | `infiniai.openManageModels` | 打开 VS Code Language Models，管理分组、秘密、可见性和逐模型控件。 |
| **InfiniAI: Open InfiniAI Logs** | `infiniai.openLogs` | 打开 `InfiniAI` 输出通道。 |
| **InfiniAI: Clear Thinking Replay Cache** | `infiniai.clearThinkingReplayCache` | 清除当前 preserved-thinking 回放存储；之后应开始新聊天。 |

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
- `isBYOK` 把 Agent 可用的 InfiniAI 模型导出到 Agents-window bridge。

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
3. 打开 **VS Code 管理模型**，确认 InfiniAI 提供方分组存在；必要时使用 **Update API Key**。
4. 检查 `infiniai.modelDiscoveryUrl` 和路由覆盖配置。
5. 运行 **InfiniAI: Refresh Models**。只有提供方分组本身未重新解析时才需要重载窗口。

## 故障排查

### 从旧版本升级

VS Code 可能会在磁盘上保留旧扩展版本目录，但它会按扩展标识扫描已安装扩展，并加载最新的有效版本。旧的 proposed API 文件或旧源码文件不会影响此版本，因为 VSIX 只打包 `out/` 中的编译后运行时代码。

升级后仍会保留的 VS Code 状态可能影响行为：

- InfiniAI 凭据只从 VS Code 提供方分组读取。从使用扩展自管凭据的旧版本升级后，如果没有提供方
  分组，请通过 **管理模型** 添加 InfiniAI。
- 当前基础 URL、`infiniai.modelDiscoveryUrl` 和 `infiniai.modelRoutes` 仍会生效。扩展不会改写用户提供的路由或模型发现覆盖。
- 已打开窗口可能继续运行旧的扩展主机，直到重新加载窗口。

升级后建议运行：

```text
@infiniai /doctor
@infiniai /models refresh
```

如果诊断结果显示了意外的端点或路由覆盖，请重置对应的当前 `infiniai.*` 设置并重新加载窗口。

### 没有模型出现

按以下顺序检查：

1. 打开 **VS Code 管理模型**，按需添加 InfiniAI，并确认提供方分组的 API Key。
2. 运行 `@infiniai /doctor`，检查提供方分组状态、模型发现端点和最近错误。
3. 清空 `infiniai.modelDiscoveryUrl`，除非您明确需要自定义模型发现端点。
4. 临时清空 `infiniai.modelRoutes`，排除错误路由覆盖的影响。
5. 运行 **InfiniAI: Refresh Models**。该操作可取消；失败提示会直接提供 **管理模型** 和 **打开日志**
   补救入口。

### 普通选择器中可见，但 Agents 中缺失

1. 在 InfiniAI **模型** 树中查看该模型 tooltip 的 **Agent eligibility** 及来源。
2. 运行 **InfiniAI: Configure Agent Eligibility**。优先使用 **Automatic**；只有确认 InfiniAI 路由支持工具
   调用和工具结果回放时才选择 **Enable for Agent**。
3. 确认 `infiniai.disableToolCallingModels` 没有匹配该 ID，并检查是否存在阻止精确覆盖的通配符。
4. 确认 VS Code 的 `chat.agentHost.byokModels.enabled` 已启用。修改 agent-host 设置后需要重启 agent host。

模型可被选择只说明 VS Code 接受了能力元数据；如果 InfiniAI 上游渠道不可用或协议不兼容，请求仍可能失败。

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
