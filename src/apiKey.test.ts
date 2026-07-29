import assert from "assert/strict";

const Module = require("module") as any;

class TestSecretStorage {
	readonly values = new Map<string, string>();
	readonly stores: Array<{ key: string; value: string }> = [];

	constructor(initial: Record<string, string> = {}) {
		for (const [key, value] of Object.entries(initial)) {
			this.values.set(key, value);
		}
	}

	async get(key: string): Promise<string | undefined> {
		return this.values.get(key);
	}

	async store(key: string, value: string): Promise<void> {
		this.stores.push({ key, value });
		this.values.set(key, value);
	}
}

function loadUtils(inputValue?: string) {
	const originalLoad = Module._load;
	const calls = {
		inputs: 0,
		lastInputOptions: undefined as Record<string, unknown> | undefined,
	};
	const vscodeMock = {
		l10n: {
			t: (message: string, ...args: unknown[]) =>
				args.length === 0 ? message : message.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)])),
		},
		window: {
			showInputBox: async (options: Record<string, unknown>) => {
				calls.inputs += 1;
				calls.lastInputOptions = options;
				return inputValue;
			},
		},
	};
	delete require.cache[require.resolve("./utils")];
	Module._load = (request: string, parent: unknown, isMain: boolean) => {
		if (request === "vscode") {
			return vscodeMock;
		}
		return originalLoad(request, parent, isMain);
	};
	try {
		return {
			utils: require("./utils") as typeof import("./utils"),
			calls,
		};
	} finally {
		Module._load = originalLoad;
	}
}

describe("InfiniAI API key", () => {
	it("returns the saved key without prompting", async () => {
		const { utils, calls } = loadUtils();
		const secrets = new TestSecretStorage({
			[utils.INFINIAI_API_KEY_SECRET_NAME]: "current-key",
		});

		const result = await utils.ensureApiKey(false, secrets as any);

		assert.equal(result, "current-key");
		assert.equal(calls.inputs, 0);
		assert.deepEqual(secrets.stores, []);
	});

	it("does not prompt when a silent flow has no key", async () => {
		const { utils, calls } = loadUtils();
		const secrets = new TestSecretStorage();

		const result = await utils.ensureApiKey(true, secrets as any);

		assert.equal(result, undefined);
		assert.equal(calls.inputs, 0);
		assert.deepEqual(secrets.stores, []);
	});

	it("stores a trimmed key entered interactively", async () => {
		const { utils, calls } = loadUtils("  new-key  ");
		const secrets = new TestSecretStorage();

		const result = await utils.ensureApiKey(false, secrets as any);

		assert.equal(result, "new-key");
		assert.equal(calls.inputs, 1);
		assert.deepEqual(secrets.stores, [{ key: utils.INFINIAI_API_KEY_SECRET_NAME, value: "new-key" }]);
	});

	it("prefills the saved key when updating it", async () => {
		const { utils, calls } = loadUtils("updated-key");
		const secrets = new TestSecretStorage({
			[utils.INFINIAI_API_KEY_SECRET_NAME]: "current-key",
		});

		const result = await utils.configureApiKey(secrets as any);

		assert.equal(result, "updated-key");
		assert.equal(calls.lastInputOptions?.value, "current-key");
		assert.deepEqual(secrets.stores, [{ key: utils.INFINIAI_API_KEY_SECRET_NAME, value: "updated-key" }]);
	});

	it("leaves storage unchanged when entry is canceled", async () => {
		const { utils } = loadUtils();
		const secrets = new TestSecretStorage();

		const result = await utils.configureApiKey(secrets as any);

		assert.equal(result, undefined);
		assert.deepEqual(secrets.stores, []);
	});
});
