import assert from "assert/strict";

import { readProviderApiKey, readProviderGroupName } from "./providerConfiguration";

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

	it("reads and trims the VS Code provider-group name", () => {
		assert.equal(readProviderGroupName({ silent: true, group: "  InfiniAI Team  " } as any), "InfiniAI Team");
		assert.equal(readProviderGroupName({ silent: true, group: " " } as any), undefined);
		assert.equal(readProviderGroupName({ silent: true, group: 1 } as any), undefined);
	});
});
