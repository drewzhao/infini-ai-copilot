# Verify InfiniAI model discovery

Open the **InfiniAI** activity bar after adding the provider group.

1. Expand **Provider Groups** and confirm that a provider configuration appears.
2. Run **Refresh Models** if model discovery has not completed.
3. Inspect the **Models** tree for model visibility, transport, Agent eligibility and its metadata source, image input,
   and token limits.
4. If a model needs an exact Agent override, run **Configure Agent Eligibility** from its context menu and choose
   **Automatic**, **Enable for Agent**, or **Disable for Agent**. Enabling metadata cannot add upstream tool support.
5. In Chat, run `@infiniai /doctor` for provider status or `@infiniai /test` for a minimal connectivity request.

Use **Open VS Code Manage Models** to update the API key, rename or delete the group, and control VS Code picker
visibility.
