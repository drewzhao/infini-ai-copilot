import assert from "assert/strict";

import { hasProviderConfiguration, readProviderApiKey } from "./providerConfiguration";

describe("provider configuration", () => {
	it("reads and trims the VS Code provider-group API key", () => {
		assert.equal(
			readProviderApiKey({
				silent: true,
				configuration: { apiKey: "  sk-provider-group  " },
			} as any),
			"sk-provider-group"
		);
	});

	it("rejects empty and malformed provider configuration", () => {
		assert.equal(readProviderApiKey({ silent: true } as any), undefined);
		assert.equal(readProviderApiKey({ silent: true, configuration: { apiKey: " " } } as any), undefined);
		assert.equal(readProviderApiKey({ silent: true, configuration: { apiKey: 123 } } as any), undefined);
		assert.equal(readProviderApiKey({ silent: true, configuration: [] } as any), undefined);
	});

	it("distinguishes VS Code's groupless pass from configured groups", () => {
		assert.equal(hasProviderConfiguration({ silent: true } as any), false);
		assert.equal(hasProviderConfiguration({ silent: true, configuration: undefined } as any), false);
		assert.equal(hasProviderConfiguration({ silent: true, configuration: {} } as any), true);
		assert.equal(hasProviderConfiguration({ silent: true, configuration: { apiKey: "sk-group" } } as any), true);
	});
});
