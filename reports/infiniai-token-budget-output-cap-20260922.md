# InfiniAI Copilot 扩展的 token 预算派生缺陷与输出封顶缓解

**日期**：2026-09-22
**范围**：`zenmux-copilot`（infini-ai-copilot 扩展）token 预算广告链路；对照 `microsoft/vscode` 1.138（`extensions/copilot` 与 agents 窗口 BYOK 桥）
**关键词**：`maxInputTokens` / `maxOutputTokens`、context window 求和推导、compaction 触发时机、`PRACTICAL_MAX_OUTPUT_TOKENS`

---

## 一、摘要

对 VS Code 内置 Custom Endpoint 的压缩机制分析（见《VS Code 自定义端点配置与上下文压缩机制分析报告》，2026-09-22）揭示了一条通用规律：**上下文压缩不直接读配置，只消费派生值；派生链上任何一环的偏差都会静默改变压缩触发时机**。把同一框架套到本扩展后发现：

1. 本扩展广告给 VS Code 的 `maxOutputTokens` **不封顶、原样透传目录值**。对 kimi-k3（目录 `context_length` 与 `max_output_length` 均为 1048576），广告值为 `maxInput=1032192, maxOutput=1048576`，**两者之和 2080768 ≈ 真实窗口的 2 倍**。
2. VS Code agents 窗口的 BYOK 桥用 `maxInputTokens + maxOutputTokens` **求和推导上下文窗口**——与 Custom Endpoint 报告发现的 `contextWindow ??= 输入+输出` 是同构缺陷。对 kimi-k3 推导出约 2M 的虚高窗口，若 agent 内核据此做压缩预算，触发点（78% ≈ 1.62M）被推到真实 1M 窗口之外，**压缩永远来不及、先撞网关**。
3. 同一个不封顶的值还是 **Anthropic 路由必填 `max_tokens` 的默认值**与用户配置钳制的来源。⚠️ 更正：OpenAI 路由（含 kimi-k3）**默认不发 `max_tokens`**（`prepareRequestBody` 中的写入是注释掉的死代码，agents 窗口真实抓包确认 `max_tokens` 缺省）；此前"多后端 502"排障中"扩展默认上行 1M"的推断在此更正——该事件中兜底后端拒绝的具体参数仍以网关日志为准。

缓解：在 token 预算层给**广告值（及 Anthropic 路由的默认 `max_tokens`）**加实用封顶 `PRACTICAL_MAX_OUTPUT_TOKENS = 32768`，同时保留用户按模型显式配置更大输出的通道（配置上限仍用 provider 原始值）。

## 二、本扩展如何定义三个值

stable LM API 的 `LanguageModelChatInformation` **没有 contextWindow 字段**，只有 `maxInputTokens` / `maxOutputTokens`。本扩展在 `src/provider.ts` `toLanguageModelInfo()` 中从目录取值，经 `src/tokenBudget.ts` 推导：

```
contextLength     = catalog.context_length（缺省走推断/默认）
providerMaxOutput = catalog.max_output_length ?? catalog.max_tokens
maxOutputTokens   = providerMaxOutput            ← 修复前：不封顶
maxInputTokens    = contextLength − reserve
reserve           = min(providerMaxOutput, 16384, contextLength×25%)
```

kimi-k3 实例化结果（修复前）：

| 量 | 值 | 说明 |
|---|---:|---|
| contextLength | 1048576 | 目录真实窗口 |
| maxInputTokens（广告） | 1032192 | ctx − 16384，≈ 窗口的 98.4% |
| maxOutputTokens（广告） | **1048576** | 目录值原样透传 |
| 广告之和 | **2080768** | ≈ **2× 真实窗口** |
| Anthropic 路由默认 max_tokens | 1048576 | = 广告 maxOutputTokens（OpenAI 路由默认不发该字段） |

## 三、三条消费链的适用性分析

### 链 1：Copilot BYOK（`chatLanguageModels.json` → `resolveModelTokenLimits`）——不适用

那是 Custom Endpoint 配置文件路径。本扩展的模型经 stable LM API 进入，不经过该文件与 `resolveModelTokenLimits()`。（用户在 Custom Endpoint 里另行配置的 "InfiniAI Claude" 组走链 1，与本扩展并行、互不影响。）

### 链 2：经典 chat 面板 agent 模式——压缩机制完全适用，且数值健康

Copilot 用 `ExtChatEndpoint` 包装第三方 LM 模型（`extensions/copilot/src/platform/endpoint/vscode-node/extChatEndpoint.ts:63`）：

```ts
this._maxTokens = languageModel.maxInputTokens;   // ← 本扩展广告的 1032192 直接成为压缩分母
get maxOutputTokens() { return 8192; }            // ← stable 消费侧拿不到输出上限，硬编码假设
```

之后进入与 Custom Endpoint 报告完全相同的 `baseBudget` / 0.78 / 0.90 / 0.65 机制。代入 kimi-k3：分母 1032192 ≈ 真实窗口 98.4%，后台压缩约在渲染 80.5 万 token 时触发、前台预算约 93 万——**均在真实 1M 窗口内**。本扩展的 practical-reserve 推导在这条链上恰好扮演了"显式 contextWindow"的角色，链 2 无需修改。

两个本扩展特有的边界（链 2 内）：

- **replay 注入的 `reasoning_content` 对 Copilot 分子不可见**：contributed 模型经 stable API 无 usage 回流，压缩分子只有 Copilot 的渲染估算；本扩展在预算之后注入的思考文本由 reserve（16384）+ 前台 10% 余量（约 10.3 万 token）吸收。通常足够，超长会话是已知边界。
- **OpenAI 路由默认不发 `max_tokens`**（见摘要第 3 条更正），窗口共享完全由服务端决定；Anthropic 路由必填 `max_tokens`，默认取广告值。

### 链 3：agents 窗口 BYOK 桥——求和推导缺陷的同构，且被放大

`src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostByokLmHandler.ts` `listModels()`：

```ts
maxContextWindowTokens: metadata.maxInputTokens + metadata.maxOutputTokens
```

与 Custom Endpoint 报告的 `contextWindow ??= maxInput + maxOutput` 同构。修复前对 kimi-k3 推导出 2080768 ≈ 2× 真实窗口（报告场景只虚高一个输出预算，本扩展虚高一整个窗口）。影响链与该报告 2.3 节一致：窗口虚高 → 压缩分母虚高 → 触发点后移出真实窗口 → 客户端预算全部放行、网关侧撞真实上限。

## 四、缓解方案（本次落地）

### 4.1 变更内容

1. **`src/tokenBudget.ts`**：新增 `PRACTICAL_MAX_OUTPUT_TOKENS = 32768`；`computeLanguageModelTokenBudget()` 的 `maxOutputTokens` 取 `min(provider 值, 32768)`。`maxInputTokens` 推导（reserve 逻辑）不变。
2. **`src/provider.ts`**：
   - 广告值与 Anthropic 路由的默认 `max_tokens` 使用封顶后的 `maxOutputTokens`（OpenAI 路由默认不发该字段，wire 不变）；
   - **用户覆盖通道保留原始天花板**：模型配置 schema（`buildInfiniAIModelConfigurationSchema`）与请求期约束（`resolveInfiniAIModelConfiguration` 的 `constraints.maxOutputTokens`）改用 provider 原始上限（`max_output_length ?? max_tokens`），显式配置仍可解锁到目录真实上限。

### 4.2 取值理由（32768）

- Kimi 官方对思考模型的建议是 `max_tokens ≥ 16000`（reasoning 与 content 共享该预算）；32768 为其 2 倍，覆盖绝大多数交互式输出；
- 修复后 kimi-k3 的广告之和 = 1032192 + 32768 = 1064960，与真实窗口偏差 **+1.6%**，agents 窗口按此做压缩预算时触发点回到真实窗口内（78% × 1.0156 ≈ 79.2%）；
- Anthropic 路由的必填 `max_tokens` 默认值随之回到 32768；OpenAI 路由默认本就省略该字段，wire 行为不变。

### 4.3 修复前后对照（kimi-k3）

| 量 | 修复前 | 修复后 |
|---|---:|---:|
| 广告 maxOutputTokens | 1048576 | **32768** |
| 广告之和 / 真实窗口 | 198.4% | **101.6%** |
| agents 窗口派生窗口 | 2080768 | 1064960 |
| agents 窗口压缩触发点（78%）相对真实窗口 | 162%（永不触发） | **79.2%** |
| Anthropic 路由默认 max_tokens | 广告值（不封顶） | 32768 |
| OpenAI 路由默认 max_tokens | 不发送（不变） | 不发送（不变） |
| 用户可配置输出上限 | 1048576 | 1048576（不变） |

### 4.4 残余风险与不做的事

- **小上下文模型的求和仍会偏大**（如 ctx=8192 且 providerMax=8192 时和 ≈ 1.75× ctx）：输入与输出上限本就不是独立可加的量，求和派生天然近似；本次只消除了 1M 档的 2 倍级失真。根治需 VS Code 侧提供显式 contextWindow 通道（stable API 目前没有）。
- **Claude 系（Anthropic 路由）默认输出从 128k 降为 32768**：超长单轮生成会更早 `finish_reason=length`，需要时通过模型配置显式调高。
- **vertex 路径未动**（低流量，约束仍为广告值）。
- 兜底后端 2000 上限、网关转移链错误透传等问题属网关侧，见《多后端网关排障》结论，不在本次范围。

## 五、验证

- `src/tokenBudget.test.ts` 新增封顶断言（大 providerMax 被压到 32768；小于封顶的 providerMax 与 fallback 行为不变；kimi-k3 形状的和 ≈ ctx）；
- 全量 `npm test` + `npm run lint` 通过。

## 附录：关键源码索引

| 位置 | 内容 |
|---|---|
| `src/tokenBudget.ts` | `PRACTICAL_MAX_OUTPUT_TOKENS` 封顶与预算推导 |
| `src/provider.ts` `toLanguageModelInfo()` | 目录 → 广告值；schema 用原始上限 |
| `src/modelConfiguration.ts` `normalizeMaxOutputTokens()` | 用户覆盖值按 constraints 钳制 |
| vscode `extChatEndpoint.ts:63,71-79` | 经典面板：压缩分母 = 广告 maxInputTokens；输出假设 8192 |
| vscode `agentHostByokLmHandler.ts` `listModels()` | agents 窗口：`maxContextWindowTokens = maxInput + maxOutput` 求和推导 |
| vscode `agentIntent.ts` / `backgroundSummarizer.ts` | 压缩触发机制（0.78/0.90/0.65），详见 Custom Endpoint 报告 |
