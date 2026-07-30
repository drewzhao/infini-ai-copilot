# Group Name is a VS Code label

VS Code asks for **Group Name** before it asks for the InfiniAI API key. The name identifies one local provider
configuration. It is not sent to InfiniAI and does not affect requests or API-key validity.

## What should I enter?

- If you use one API key, keep the prefilled name `InfiniAI`.
- If you use multiple keys, choose a purpose-based label such as `Work`, `Personal`, or `Team A`.
- Never paste an API key or another secret into **Group Name**.

After accepting the name, enter the API key on the separate **API Key** prompt. VS Code stores it securely and associates
it with that group.

Provider groups let multiple InfiniAI accounts coexist while keeping their credentials and model settings separate. In
the Agents window, use only one group when two groups expose the same model ID.
