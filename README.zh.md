# InfiniAI Provider for VS Code

InfiniAI Provider for VS Code 将 InfiniAI 注册为稳定的 VS Code 语言模型提供方，并提供 `@infiniai` 诊断参与者。本扩展只使用公开稳定的 VS Code API，不依赖独立的 `github.copilot-chat` 扩展，也不使用 Copilot 私有或 proposed API。

## 使用方式

1. 从 [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=drewzhao.infiniai-copilot) 安装扩展。
2. 打开 VS Code Chat，并使用模型选择器。
3. 选择 **Manage Models...**，然后添加 **InfiniAI** 提供方的模型。
4. 首次使用时选择 Standard 或 Coding 方案。
5. 输入对应方案的 InfiniAI API Key。密钥会保存在 VS Code Secret Storage 中。
6. 在模型选择器中选择 InfiniAI 模型。

也可以在 Chat 中使用 `@infiniai` 进行诊断：

- `@infiniai /doctor` 检查配置、密钥是否存在、端点设置、缓存状态以及最近一次脱敏后的提供方错误。
- `@infiniai /models` 列出本地缓存中的模型和路由能力。
- `@infiniai /models refresh` 刷新模型发现结果后再列出模型。
- `@infiniai /test` 针对当前默认路由执行一个最小的、可取消的健康检查请求。

该参与者只用于诊断，不会替代通用聊天助手。

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
npm run build
```

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
- `infiniai.modelRoutes`: 可选模型路由覆盖。每项支持 `pattern`、`transport`（`"openai"`、`"anthropic"` 或 `"vertex"`）以及可选 `baseUrl`。
- `infiniai.imageInputModels`: 为匹配的模型 ID 强制启用图片输入能力。支持 `*` 通配符。
- `infiniai.disableImageInputModels`: 为匹配的模型 ID 强制禁用图片输入能力。支持 `*` 通配符。
- `infiniai.disableThinkingForModels`: 当宿主无法回传 `reasoning_content` 时,强制关闭思考模式的模型 ID 模式列表。默认涵盖已知 Xiaomi MiMo V2 模型 ID 与 DeepSeek V4 系列: `mimo-v2-pro`、`mimo-v2.5-pro`、`mimo-v2.5`、`mimo-v2-omni`、`mimo-v2-flash`、`deepseek-v4*`。详见下方[思考模式](#思考模式)。
- `infiniai.retry`: 可重试网络错误和 HTTP 错误的重试策略。
- `infiniai.delay`: 请求之间的固定延迟，单位毫秒。

路由优先级：

1. 用户配置的 `infiniai.modelRoutes` 模式匹配。
2. InfiniAI 模型元数据中的显式信息。
3. 提供方维护的模型目录元数据。
4. 保守回退到 OpenAI 兼容路由。

传输行为：

- OpenAI 兼容路由调用 `/chat/completions`。
- Anthropic 路由调用 `/v1/messages`，并使用 `x-api-key` 和 `anthropic-version`。
- Vertex 路由通过 Vertex 适配器调用 `:streamGenerateContent`。

未实现的 endpoint family 会明确失败，不会静默回退。

## 思考模式

部分 InfiniAI 模型在常规回复之外还会以 `reasoning_content` 形式流式返回思维链(目前是已知 Xiaomi MiMo V2 模型 ID 与 DeepSeek V4 系列)。这些模型的 API 要求,在对话中存在工具调用时,后续轮次必须**原样回传** `reasoning_content`。否则上游会返回:

```
HTTP 400 — reasoning_content is required when the previous assistant message contains tool calls
```

VS Code 稳定版语言模型 API (`vscode.LanguageModelChatMessage`) 没有公开的思考/推理内容 part 类型 — `LanguageModelThinkingPart` 仅作为 proposed API 存在。在稳定版上扩展无法跨轮次保存或回放推理内容,会回退到下方的强制关闭策略;在 VS Code Insiders 上扩展会运行时检测该 proposed API 是否可用,若可用则自动端到端回传 `reasoning_content`(详见 [Insiders: 端到端思考模式](#insiders-端到端思考模式))。

为避免在 VS Code 稳定版上开箱即遇到上述 400 错误,扩展会对受影响的模型 ID/系列强制关闭思考模式,在请求体中同时注入两种厂商写法:

```jsonc
{
  "enable_thinking": false,
  "thinking": { "type": "disabled" }
}
```

稳定版宿主上的默认禁用名单: `mimo-v2-pro`、`mimo-v2.5-pro`、`mimo-v2.5`、`mimo-v2-omni`、`mimo-v2-flash` (已知 Xiaomi MiMo V2 模型 ID),以及 `deepseek-v4*` (任意 DeepSeek V4 变体)。

**取舍**: 牺牲这些特定模型的思维链质量。工具调用与普通回复仍正常工作; 其他模型(Kimi K2 Thinking、DeepSeek R1、DeepSeek V3.x、Qwen、GLM 等)不受影响,思考模式照常可用。

通过 `infiniai.disableThinkingForModels` **覆盖**该行为:

- 添加模式(例如 `"my-thinker-*"`)以扩展禁用列表。
- 设为 `[]` 可在稳定版宿主上为默认模型恢复思考模式 — 仅当你已自行解决 `reasoning_content` 回传问题时(例如自建 MCP 代理或自定义传输层)才这样做。当宿主支持 `LanguageModelThinkingPart` 时,扩展会改为回传 `reasoning_content`,不应用该回退策略。

### Insiders: 端到端思考模式

扩展清单声明了 `enabledApiProposals: ["languageModelThinkingPart"]`。当宿主在运行时实际暴露该 proposed API 时,扩展会自动:

1. 将推理片段以 `LanguageModelThinkingPart` 的形式流式输出,聊天 UI 即可在多轮中保留它们。
2. 在后续轮次中将 `reasoning_content` 原样回传给 MiMo V2 / DeepSeek V4,从而避免 HTTP 400。
3. 跳过强制关闭注入,让模型自由思考。

启用方式: 使用 VS Code Insiders 并为本扩展 publisher 启用 proposed API:

```sh
code-insiders --enable-proposed-api drewzhao.infiniai-copilot
```

或在 `argv.json` 中添加 publisher id(命令面板 → "首选项: 配置运行时参数"):

```jsonc
{
  "enable-proposed-api": ["drewzhao.infiniai-copilot"]
}
```

无需任何设置开关 — 检测完全自动化。在稳定版 VS Code (或未加 flag 的 Insiders) 上,该构造器为 `undefined`,扩展会透明地回退到上文描述的强制关闭策略。

## 命令

- `infiniai.setApikey`: 设置、更新或删除 Standard/Coding 方案的 API Key。

聊天参与者命令：

- `@infiniai /doctor`
- `@infiniai /models`
- `@infiniai /models refresh`
- `@infiniai /test`

## 稳定 API 策略

本扩展刻意避免：

- `enabledApiProposals`
- `src/vscode.proposed.*.d.ts`
- Copilot 私有命令或扩展 ID
- `configurationSchema`
- `modelConfiguration`
- `chatParticipantAdditions`
- `defaultChatParticipant`
- `languageModelProxy`
- `LanguageModelThinkingPart`

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
