# 🚀 InfiniAI Provider for Copilot

欢迎使用 **InfiniAI Provider for Copilot**！这是一个专为 VS Code Copilot 打造的模型 Provider 扩展。通过本扩展，您可以将 [InfiniAI](https://infiniai.ai) 强大的模型网关能力无缝集成到 VS Code Copilot 中，自由使用各类顶尖 AI 模型。

## 💡 使用方式

只需简单几步，即可开启您的 InfiniAI 之旅：

1.  📥 **安装扩展**：点击 [这里](https://marketplace.visualstudio.com/items?itemName=drewzhao.infiniai-copilot) 安装插件。
2.  💬 **打开 Copilot**：在 VS Code 中打开 GitHub Copilot Chat 界面。
3.  ⚙️ **管理模型**：点击聊天输入框上方的模型选择器，选择 "Manage Models..."（管理模型）。
4.  ✅ **选择 InfiniAI**：点击 "Add Models" (添加模型)，然后选择 "InfiniAI" 提供方。
5.  🧭 **选择方案（仅首次）**：如果您尚未配置 `infiniai.plan`，系统会提示您选择 **Standard Plan** 或 **Coding Plan**，并将选择保存到 VS Code 用户设置中。
6.  🔑 **配置密钥**：输入所选方案对应的 InfiniAI API Key（密钥会安全存储在 VS Code Secret Storage 中）。
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

- `infiniai.plan`: 选择 InfiniAI 计费方案 — `"standard"`（按量付费）或 `"coding"`（Coding Plan 订阅）。如果未设置，扩展在接口路由上会按 `"standard"` 处理；当扩展需要交互式提示输入 API Key 时，会先提示您选择方案并保存。
- `infiniai.baseUrl`: OpenAI 兼容 API 基础 URL，标准版（默认：`https://cloud.infini-ai.com/maas/v1`）。
- `infiniai.anthropic.baseUrl`: Anthropic 兼容 API 基础 URL，标准版（默认：`https://cloud.infini-ai.com/maas`）。
- `infiniai.coding.baseUrl`: OpenAI 兼容 API 基础 URL，Coding Plan（默认：`https://cloud.infini-ai.com/maas/coding/v1`）。
- `infiniai.coding.anthropic.baseUrl`: Anthropic 兼容 API 基础 URL，Coding Plan（默认：`https://cloud.infini-ai.com/maas/coding`）。
- `infiniai.imageInputModels`: 强制为指定模型启用图片输入（支持 `*` 通配符，例如 `kimi-*`）。当某些多模态模型名称不包含 `-vision` 等标识时可使用。
- `infiniai.disableImageInputModels`: 强制为指定模型禁用图片输入（支持 `*` 通配符）。
- `infiniai.retry`: 请求重试策略（是否启用、最大尝试次数、间隔毫秒数）。
- `infiniai.delay`: 请求之间的固定延迟（毫秒）。

## 🧠 思考 / 推理参数

**状态 (v0.2.1+)**: 思考/推理参数目前**不会发送到 API**。扩展在内部识别这些模型配置选项（`enable_thinking`、`thinking_budget`、`reasoning_effort`、`thinking`），但将这些参数包含在 API 请求中的代码已被注释掉。这意味着：

- 支持思考/推理的模型将使用其默认行为
- 您目前无法通过此扩展启用或配置思考功能
- 从模型接收到的思考内容会在内部跟踪，但不会显示在 Copilot Chat 中

如果您需要启用思考功能，需要修改扩展代码 `src/openai/openaiApi.ts` 以取消相关参数处理的注释。

## ⌨️ 命令

- `infiniai.setApikey`: 通过命令面板 (`Ctrl+Shift+P`) 运行此命令，可随时设置或更新您的 InfiniAI API Key。系统会先提示您选择要配置哪个方案（标准版或 Coding Plan）的密钥。

## 🧪 测试

```powershell
npm test
```

## 🔍 调试技巧

如果遇到扩展未激活或无日志的情况：

- 🧐 确保您正在查看的是 **扩展开发主机** 的窗口。
- 📄 检查 **输出面板** 中的 `InfiniAI` 通道。
- 🐞 打开 **开发者工具** (帮助 → 切换开发人员工具) 查看控制台报错。
- 🔄 尝试 **重载窗口** (`Developer: Reload Window`)。
- 📁 确认 `out/extension.js` 文件是否存在（请确保已运行 `npm run compile`）。

## 🤝 贡献与反馈

我们非常欢迎您的参与！

- 🐛 **提交问题**: [GitHub Issues](https://github.com/drewzhao/infini-ai-copilot/issues)
- 🔀 **贡献代码**: 欢迎 Fork 本仓库并提交 Pull Request。

## 📄 许可证

[MIT License](LICENSE)
