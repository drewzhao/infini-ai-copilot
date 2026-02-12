# 🚀 InfiniAI Provider for Copilot

Welcome to **InfiniAI Provider for Copilot**! This is a model provider extension designed specifically for VS Code Copilot. With this extension, you can seamlessly integrate the powerful model gateway capabilities of [InfiniAI](https://infiniai.ai) into VS Code Copilot, giving you the freedom to use top-tier AI models.

## 💡 Usage

Just a few simple steps to start your InfiniAI journey:

1.  📥 **Install Extension**: Click [here](https://marketplace.visualstudio.com/items?itemName=drewzhao.infiniai-copilot) to install the extension.
2.  💬 **Open Copilot**: Open the GitHub Copilot Chat interface in VS Code.
3.  ⚙️ **Manage Models**: Click the model picker below the chat input box and select "Manage Models...".
4.  ✅ **Select InfiniAI**: Click "Add Models" and then select the "InfiniAI" provider.
5.  🧭 **Select Plan (first time only)**: If you haven't configured `infiniai.plan` yet, you'll be prompted to pick **Standard Plan** or **Coding Plan**. The choice will be saved to your VS Code user settings.
6.  🔑 **Configure Key**: Enter your InfiniAI API Key for the selected plan (the key is stored securely in VS Code Secret Storage).
6.  🎯 **Pick Models**: Select the specific models you wish to use in the model picker.

## ℹ️ Extension Information

- **Name**: InfiniAI Provider for Copilot
- **Version**: See `package.json`

## ✅ Prerequisites

Before you begin, please ensure you meet the following requirements:

- 💻 **VS Code Version**: >= 1.104.0
- 🧩 **Copilot Extension**: `github.copilot-chat` extension installed
- 🔑 **API Key**: A valid InfiniAI API Key (get it from [infiniai.ai](https://infiniai.ai))
- 🟢 **Node.js**: (Required only for development and building)

## 🛠️ Installation & Build (Development Guide)

If you are a developer and want to build or modify this project yourself:

**1. Install Dependencies**

```powershell
npm install
```

**2. Compile TypeScript**

```powershell
npm run compile
```

**3. Package VSIX (Optional)**

```powershell
npm run build
```

## 🐛 Run in Extension Development Host

1.  Open this repository in VS Code.
2.  Press `F5` to launch the **Extension Development Host**.
3.  In the development host, open Copilot Chat; you should be able to see and use the `InfiniAI Provider`.

## 📝 Activation & Logging

- **Activation Events**: The extension activates when events declared in `package.json` are triggered (e.g., `onStartupFinished` or when running a command).
- **View Logs**:
    1.  Open the Output Panel (View → Output or `Ctrl+Shift+U`).
    2.  Select the `InfiniAI` channel from the dropdown menu in the top right corner.

## ⚙️ Configuration (Common)

You can adjust the following parameters in VS Code Settings:

- `infiniai.plan`: Select the InfiniAI billing plan — `"standard"` (pay-per-token) or `"coding"` (Coding Plan subscription). If unset, the extension treats it as `"standard"` for API routing, and will prompt you to pick a plan the next time it needs to ask for an API key interactively.
- `infiniai.baseUrl`: Base URL for OpenAI-compatible API, Standard Plan (Default: `https://cloud.infini-ai.com/maas/v1`).
- `infiniai.anthropic.baseUrl`: Base URL for Anthropic-compatible API, Standard Plan (Default: `https://cloud.infini-ai.com/maas`).
- `infiniai.coding.baseUrl`: Base URL for OpenAI-compatible API, Coding Plan (Default: `https://cloud.infini-ai.com/maas/coding/v1`).
- `infiniai.coding.anthropic.baseUrl`: Base URL for Anthropic-compatible API, Coding Plan (Default: `https://cloud.infini-ai.com/maas/coding`).
- `infiniai.retry`: Request retry policy (enabled, max attempts, interval in ms).
- `infiniai.delay`: Fixed delay between requests (in milliseconds).

## ⌨️ Commands

- `infiniai.setApikey`: Run this command via the Command Palette (`Ctrl+Shift+P`) to set or update your InfiniAI API Key. You will be prompted to choose which plan (Standard or Coding) to configure the key for.

## 🧪 Tests

```powershell
npm test
```

## 🔍 Debugging Tips

If the extension does not activate or shows no logs:

- 🧐 Ensure you are viewing the **Extension Development Host** window.
- 📄 Check the `InfiniAI` channel in the **Output Panel**.
- 🐞 Open **Developer Tools** (Help → Toggle Developer Tools) to check for console errors.
- 🔄 Try **Reload Window** (`Developer: Reload Window`).
- 📁 Confirm that the `out/extension.js` file exists (ensure you have run `npm run compile`).

## 🤝 Contributing & Feedback

We welcome your participation!

- 🐛 **Submit Issues**: [GitHub Issues](https://github.com/drewzhao/infini-ai-copilot/issues)
- 🔀 **Contribute Code**: Feel free to Fork this repository and submit a Pull Request.

## 📄 License

[MIT License](LICENSE)
