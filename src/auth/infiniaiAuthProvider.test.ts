import assert from "assert/strict";

const Module = require("module") as any;

class TestEventEmitter<T> {
	private readonly listeners: Array<(event: T) => void> = [];
	readonly event = (listener: (event: T) => void) => {
		this.listeners.push(listener);
		return { dispose() {} };
	};

	fire(event: T): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}

	dispose(): void {}
}

class TestSecretStorage {
	readonly values = new Map<string, string>();
	private readonly listeners: Array<(event: { key: string }) => void> = [];

	constructor(initial: Record<string, string> = {}) {
		for (const [key, value] of Object.entries(initial)) {
			this.values.set(key, value);
		}
	}

	async get(key: string): Promise<string | undefined> {
		return this.values.get(key);
	}

	async store(key: string, value: string): Promise<void> {
		this.values.set(key, value);
		this.fire(key);
	}

	async delete(key: string): Promise<void> {
		this.values.delete(key);
		this.fire(key);
	}

	onDidChange(listener: (event: { key: string }) => void) {
		this.listeners.push(listener);
		return { dispose() {} };
	}

	private fire(key: string): void {
		for (const listener of this.listeners) {
			listener({ key });
		}
	}
}

function loadAuthProvider() {
	const originalLoad = Module._load;
	const vscodeMock = {
		EventEmitter: TestEventEmitter,
		l10n: {
			t: (message: string, ...args: unknown[]) =>
				args.length === 0 ? message : message.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)])),
		},
	};
	delete require.cache[require.resolve("../utils")];
	delete require.cache[require.resolve("./infiniaiAuthProvider")];
	Module._load = (request: string, parent: unknown, isMain: boolean) => {
		if (request === "vscode") {
			return vscodeMock;
		}
		return originalLoad(request, parent, isMain);
	};
	try {
		return require("./infiniaiAuthProvider") as typeof import("./infiniaiAuthProvider");
	} finally {
		Module._load = originalLoad;
	}
}

describe("InfiniAIAuthenticationProvider", () => {
	it("exposes one generic account", async () => {
		const auth = loadAuthProvider();
		const secrets = new TestSecretStorage({ "infiniai.apiKey": "current-1234" });
		const provider = new auth.InfiniAIAuthenticationProvider(secrets as any, { promptApiKey: async () => undefined });

		const sessions = await provider.getSessions(["api"]);

		assert.equal(sessions.length, 1);
		assert.equal(sessions[0].id, "infiniai");
		assert.equal(sessions[0].accessToken, "current-1234");
		assert.equal(sessions[0].account.label, "InfiniAI …1234");
		assert.deepEqual(sessions[0].scopes, ["api"]);
		provider.dispose();
	});

	it("stores and removes the API key", async () => {
		const auth = loadAuthProvider();
		const secrets = new TestSecretStorage({ "unrelated.secret": "keep-me" });
		let nextKey = "new-key";
		const provider = new auth.InfiniAIAuthenticationProvider(secrets as any, {
			promptApiKey: async () => nextKey,
		});
		const changes: any[] = [];
		provider.onDidChangeSessions((event) => changes.push(event));

		const session = await provider.createSession([]);
		assert.equal(session.accessToken, "new-key");
		assert.equal(secrets.values.get("infiniai.apiKey"), "new-key");
		assert.equal(secrets.values.get("unrelated.secret"), "keep-me");
		assert.equal(changes.length, 1);
		assert.deepEqual(
			changes[0].added.map((candidate: any) => candidate.accessToken),
			["new-key"]
		);
		assert.deepEqual(changes[0].changed, []);
		assert.deepEqual(changes[0].removed, []);

		nextKey = "updated-key";
		const updated = await provider.configureSession();
		assert.equal(updated?.accessToken, "updated-key");
		assert.equal(changes.length, 2);
		assert.deepEqual(
			changes[1].changed.map((candidate: any) => candidate.accessToken),
			["updated-key"]
		);
		assert.deepEqual(changes[1].added, []);
		assert.deepEqual(changes[1].removed, []);

		await provider.removeSession(session.id);
		assert.equal(secrets.values.has("infiniai.apiKey"), false);
		assert.equal(secrets.values.get("unrelated.secret"), "keep-me");
		assert.equal(changes.length, 3);
		assert.deepEqual(
			changes[2].removed.map((candidate: any) => candidate.accessToken),
			["updated-key"]
		);
		assert.deepEqual(changes[2].added, []);
		assert.deepEqual(changes[2].changed, []);
		provider.dispose();
	});
});
