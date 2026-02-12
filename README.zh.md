# 🚀 InfiniAI Provider for Copilot

欢迎使用 **InfiniAI Provider for Copilot**！这是一个专为 VS Code Copilot 打造的模型 Provider 扩展。通过本扩展，您可以将 [InfiniAI](https://infiniai.ai) 强大的模型网关能力无缝集成到 VS Code Copilot 中，自由使用各类顶尖 AI 模型。

## 💡 使用方式

只需简单几步，即可开启您的 InfiniAI 之旅：

1.  📥 **安装扩展**：点击 [这里](https://marketplace.visualstudio.com/items?itemName=drewzhao.infiniai-copilot) 安装插件。
2.  💬 **打开 Copilot**：在 VS Code 中打开 GitHub Copilot Chat 界面。
3.  ⚙️ **管理模型**：点击聊天输入框上方的模型选择器，选择 "Manage Models..."（管理模型）。
4.  ✅ **选择 InfiniAI**：点击 "Add Models" (添加模型)，然后选择 "InfiniAI" 提供方。
5.  🔑 **配置密钥**：输入您的 InfiniAI API Key（密钥将安全地保存在本地）。
6.  🎯 **挑选模型**：选择您希望在模型选择器中使用的具体模型。

## ℹ️ 扩展信息

- **名称**: InfiniAI Provider for Copilot
- **版本**: 参见 `package.json`

## ✅ 使用前提

在开始之前，请确保您满足以下条件：

- 💻 **VS Code 版本**: >= 1.104.0
- 🧩 **Copilot 扩展**: 已安装 `github.copilot-chat` 扩展
- 🔑 **API Key**: 拥有有效的 InfiniAI API Key（可从 [infiniai.ai](https://infiniai.ai) 获取）
- 🟢 **Node.js**: (仅开发和构建时需要)

## 🛠️ 安装与构建 (开发指南)

如果您是开发者，想要自行构建或修改本项目：

**1. 安装依赖**

```powershell
npm install
```

**2. 编译 TypeScript**

```powershell
npm run compile
```

**3. 打包 VSIX (可选)**

```powershell
npm run build
```

## 🐛 在扩展开发主机中运行

1.  在 VS Code 中打开此仓库。
2.  按 `F5` 键启动 **扩展开发主机 (Extension Development Host)**。
3.  在开发主机中，打开 Copilot Chat，您应该能看到并使用 `InfiniAI Provider`。

## 📝 激活与日志

- **激活事件**: 扩展会在 `package.json` 中声明的事件触发时激活（如 `onStartupFinished` 或执行命令时）。
- **查看日志**:
    1.  打开输出面板 (视图 → 输出 或 `Ctrl+Shift+U`)。
    2.  在右上角下拉菜单中选择 `InfiniAI` 通道。

## ⚙️ 配置 (通用)

您可以在 VS Code 设置中调整以下参数：

- `infiniai.plan`: 选择 InfiniAI 计费方案 — `"standard"`（按量付费，默认）或 `"coding"`（Coding Plan 订阅）。Coding Plan 使用独立的 API Key 和不同的 API 端点（`/maas/coding/v1/...`）。
- `infiniai.baseUrl`: InfiniAI 网关的基础 URL（默认：`https://cloud.infini-ai.com/maas/v1`）。当 `infiniai.plan` 设为 `"coding"` 时自动调整。
- `infiniai.anthropic.baseUrl`: 兼容 Anthropic 的后端 URL。当 `infiniai.plan` 设为 `"coding"` 时自动调整。
- `infiniai.retry`: 请求重试策略（是否启用、最大尝试次数、间隔毫秒数）。
- `infiniai.delay`: 请求之间的固定延迟（毫秒）。

## ⌨️ 命令

- `infiniai.setApikey`: 通过命令面板 (`Ctrl+Shift+P`) 运行此命令，可随时设置或更新您的 InfiniAI API Key。系统会先提示您选择要配置哪个方案（标准版或 Coding Plan）的密钥。

## 🔍 调试技巧

如果遇到扩展未激活或无日志的情况：

- 🧐 确保您正在查看的是 **扩展开发主机** 的窗口。
- 📄 检查 **输出面板** 中的 `InfiniAI` 通道。
- 🐞 打开 **开发者工具** (帮助 → 切换开发人员工具) 查看控制台报错。
- 🔄 尝试 **重载窗口** (`Developer: Reload Window`)。
- 📁 确认 `out/extension.js` 文件是否存在（请确保已运行 `npm run compile`）。

## 🐞 已知问题与解决方案

### Coding Plan API 的非标准 `/v1/models` 响应 (2026-02-12)

InfiniAI Coding Plan API 返回的 `/v1/models` 响应格式不符合标准 OpenAI 兼容格式。标准格式为：

```json
{ "object": "list", "data": [ { "id": "model-name", ... } ] }
```

而 Coding Plan 额外包裹了一层信封结构：

```json
{ "code": 0, "msg": "Success", "data": { "object": "list", "data": [ { "id": "model-name", ... } ] } }
```

**修复方案：** 扩展在运行时自动检测两种响应结构 —— 先尝试将 `response.data` 作为数组解析（标准格式），若不匹配则回退到 `response.data.data`（Coding Plan 信封格式）。此方案向前兼容：如果 Coding Plan API 后续修复为标准格式，无需修改代码。

## 🤝 贡献与反馈

我们非常欢迎您的参与！

- 🐛 **提交问题**: [GitHub Issues](https://github.com/drewzhao/infini-ai-copilot/issues)
- 🔀 **贡献代码**: 欢迎 Fork 本仓库并提交 Pull Request。

## 📄 许可证

[MIT License](LICENSE)
