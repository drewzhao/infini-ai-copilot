import assert from "assert/strict";

const Module = require("module") as any;

function loadProvider() {
	const originalLoad = Module._load;
	const cancellationToken = {
		isCancellationRequested: false,
		onCancellationRequested: () => ({ dispose() {} }),
	};
	class TestCancellationTokenSource {
		private cancelled = false;
		private readonly listeners = new Set<() => void>();
		readonly token: {
			readonly isCancellationRequested: boolean;
			onCancellationRequested(listener: () => void): { dispose(): void };
		};
		constructor() {
			const token = {} as TestCancellationTokenSource["token"];
			Object.defineProperty(token, "isCancellationRequested", {
				get: () => this.cancelled,
			});
			token.onCancellationRequested = (listener: () => void) => {
				this.listeners.add(listener);
				return { dispose: () => this.listeners.delete(listener) };
			};
			this.token = token;
		}
		cancel() {
			if (this.cancelled) {
				return;
			}
			this.cancelled = true;
			for (const listener of this.listeners) {
				listener();
			}
		}
		dispose() {
			this.listeners.clear();
		}
	}
	const vscodeMock = {
		EventEmitter: class EventEmitter<T> {
			private readonly listeners = new Set<(value: T) => void>();
			event = (listener: (value: T) => void) => {
				this.listeners.add(listener);
				return { dispose: () => this.listeners.delete(listener) };
			};
			fire(value: T) {
				for (const listener of this.listeners) {
					listener(value);
				}
			}
			dispose() {
				this.listeners.clear();
			}
		},
		ThemeIcon: class {
			constructor(readonly id: string) {}
		},
		ThemeColor: class {
			constructor(readonly id: string) {}
		},
		CancellationTokenSource: TestCancellationTokenSource,
		CancellationToken: {
			None: cancellationToken,
		},
		CancellationError: class CancellationError extends Error {},
		ProgressLocation: {
			Notification: 15,
		},
		workspace: {
			getConfiguration: () => ({
				get: (_key: string, defaultValue?: unknown) => defaultValue,
			}),
		},
		window: {
			showErrorMessage: async () => undefined,
			showWarningMessage: async () => undefined,
			withProgress: async (_options: unknown, task: (progress: unknown, token: unknown) => unknown) =>
				task({}, cancellationToken),
		},
		commands: {
			executeCommand: async () => undefined,
		},
		env: {
			appName: "VS Code",
			openExternal: async () => undefined,
		},
		Uri: {
			parse: (value: string) => ({ toString: () => value }),
		},
		LanguageModelChatMessageRole: {
			User: 1,
			Assistant: 2,
		},
		LanguageModelChatToolMode: {
			Required: 1,
		},
		l10n: {
			t: (message: string, ...args: unknown[]) =>
				args.length === 0 ? message : message.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)])),
		},
	};

	for (const id of ["./provider", "./utils", "./statusBar", "./errorActions"]) {
		delete require.cache[require.resolve(id)];
	}

	Module._load = (request: string, parent: unknown, isMain: boolean) => {
		if (request === "vscode") {
			return vscodeMock;
		}
		return originalLoad(request, parent, isMain);
	};
	try {
		return require("./provider") as typeof import("./provider");
	} finally {
		Module._load = originalLoad;
	}
}

function cacheEntry(key: string, fetchedAt: number) {
	return {
		key,
		models: [],
		infos: [],
		routes: new Map(),
		discoveryStats: {
			rawModelCount: 0,
			chatModelCount: 0,
			nonChatModelCount: 0,
			unknownModelTypeCount: 0,
			malformedModelCount: 0,
			duplicateModelCount: 0,
			liveOutputLimitCount: 0,
		},
		fetchedAt,
		signature: key,
	};
}

const token = {
	isCancellationRequested: false,
	onCancellationRequested: () => ({ dispose() {} }),
};

describe("InfiniAIChatModelProvider request headers", () => {
	it("sends Bearer auth as well as x-api-key on Anthropic Messages routes", () => {
		const { InfiniAIChatModelProvider } = loadProvider();
		const provider = new InfiniAIChatModelProvider("test-agent", {} as any, { appendLine() {} } as any);

		const headers = (provider as any).requestHeaders({ transport: "anthropic" }, "sk-test");

		assert.equal(headers.Authorization, "Bearer sk-test");
		assert.equal(headers["x-api-key"], "sk-test");
		assert.equal(headers["anthropic-version"], "2023-06-01");
		assert.equal(headers["Content-Type"], "application/json");
	});
});

describe("InfiniAIChatModelProvider model cache", () => {
	it("does not duplicate configurable provider models in VS Code's groupless discovery pass", async () => {
		const { InfiniAIChatModelProvider } = loadProvider();
		const provider = new InfiniAIChatModelProvider("test-agent", {} as any, { appendLine() {} } as any);
		(provider as any)._providerGroups.set("cache-key", {
			name: "Provider configuration 1",
			apiKey: "sk-group",
			cacheKey: "cache-key",
		});

		const result = await provider.provideLanguageModelChatInformation({ silent: true }, token as any);

		assert.deepEqual(result, []);
		assert.equal((provider as any)._providerGroups.size, 0);
	});

	it("reports a configured provider group whose API key is missing", async () => {
		const { InfiniAIChatModelProvider } = loadProvider();
		const provider = new InfiniAIChatModelProvider("test-agent", {} as any, { appendLine() {} } as any);

		await assert.rejects(
			provider.provideLanguageModelChatInformation({ silent: true, configuration: {} } as any, token as any),
			/no API key/
		);
	});

	it("binds each configured model object to its exact API key", async () => {
		const { InfiniAIChatModelProvider } = loadProvider();
		const provider = new InfiniAIChatModelProvider("test-agent", {} as any, { appendLine() {} } as any);
		const info = { id: "test-model" };
		const entry = { ...cacheEntry("cache-key", Date.now()), infos: [info] };
		(provider as any).buildCacheKey = () => "cache-key";
		(provider as any)._cacheByKey.set("cache-key", entry);
		(provider as any)._lastGoodCacheByKey.set("cache-key", entry);

		const result = await provider.provideLanguageModelChatInformation(
			{ silent: true, configuration: { apiKey: "sk-group" } } as any,
			token as any
		);

		assert.deepEqual(result, [info]);
		assert.notEqual(result[0], info);
		assert.equal((provider as any)._modelCredentials.get(info), undefined);
		assert.deepEqual((provider as any)._modelCredentials.get(result[0]), {
			name: "Provider configuration 1",
			apiKey: "sk-group",
			cacheKey: "cache-key",
		});
	});

	it("keeps same-key provider model objects isolated while sharing credential-scoped cache state", async () => {
		const { InfiniAIChatModelProvider } = loadProvider();
		const provider = new InfiniAIChatModelProvider("test-agent", {} as any, { appendLine() {} } as any);
		const info = { id: "test-model" };
		const entry = { ...cacheEntry("cache-key", Date.now()), infos: [info] };
		(provider as any).buildCacheKey = () => "cache-key";
		(provider as any)._cacheByKey.set("cache-key", entry);
		(provider as any)._lastGoodCacheByKey.set("cache-key", entry);

		const first = await provider.provideLanguageModelChatInformation(
			{ silent: true, configuration: { apiKey: "sk-shared" } } as any,
			token as any
		);
		const second = await provider.provideLanguageModelChatInformation(
			{ silent: true, configuration: { apiKey: "sk-shared" } } as any,
			token as any
		);

		assert.notEqual(first[0], second[0]);
		assert.equal((provider as any)._modelCredentials.get(first[0]), (provider as any)._modelCredentials.get(second[0]));
		assert.deepEqual([...((provider as any)._providerGroups as Map<string, unknown>).keys()], ["cache-key"]);
		assert.equal((provider as any)._cacheByKey.get("cache-key"), entry);
		assert.equal((provider as any)._lastGoodCacheByKey.get("cache-key"), entry);
	});

	it("settles cached models after the groupless RPC gap without rediscovery", async () => {
		const { InfiniAIChatModelProvider } = loadProvider();
		const provider = new InfiniAIChatModelProvider("test-agent", {} as any, { appendLine() {} } as any);
		const info = { id: "test-model" };
		const entry = { ...cacheEntry("cache-key", Date.now()), infos: [info] };
		(provider as any).buildCacheKey = () => "cache-key";
		let resolveFetch!: (entry: any) => void;
		let fetches = 0;
		(provider as any).fetchAndNormalizeModels = async () => {
			fetches++;
			return await new Promise<typeof entry>((resolve) => {
				resolveFetch = resolve;
			});
		};
		let changes = 0;
		provider.onDidChangeLanguageModelChatInformation(() => changes++);

		await provider.provideLanguageModelChatInformation({ silent: true }, token as any);
		await new Promise((resolve) => setTimeout(resolve, 0));
		await assert.rejects(
			provider.provideLanguageModelChatInformation({ silent: true, configuration: {} } as any, token as any),
			/no API key/
		);
		const initial = await provider.provideLanguageModelChatInformation(
			{ silent: true, configuration: { apiKey: "sk-group" } } as any,
			token as any
		);
		assert.deepEqual(initial, []);
		assert.equal(fetches, 1);
		const discovery = (provider as any)._modelDiscoveryOperations.get("cache-key").promise;
		resolveFetch(entry);
		await discovery;
		assert.equal(changes, 1);

		for (let cycle = 0; cycle < 2; cycle++) {
			await provider.provideLanguageModelChatInformation({ silent: true }, token as any);
			await new Promise((resolve) => setTimeout(resolve, 0));
			await assert.rejects(
				provider.provideLanguageModelChatInformation({ silent: true, configuration: {} } as any, token as any),
				/no API key/
			);
			const resolved = await provider.provideLanguageModelChatInformation(
				{ silent: true, configuration: { apiKey: "sk-group" } } as any,
				token as any
			);
			assert.equal(resolved.length, 1);
			assert.equal(resolved[0].id, "test-model");
		}

		assert.equal(fetches, 1);
		assert.equal(changes, 1);
	});

	it("retains distinct credentials when VS Code resolves multiple configurations without group names", async () => {
		const { InfiniAIChatModelProvider } = loadProvider();
		const provider = new InfiniAIChatModelProvider("test-agent", {} as any, { appendLine() {} } as any);
		const info = { id: "test-model" };
		(provider as any).buildCacheKey = (apiKey: string) => `cache-${apiKey}`;
		for (const apiKey of ["sk-a", "sk-b"]) {
			const key = `cache-${apiKey}`;
			const entry = { ...cacheEntry(key, Date.now()), infos: [info] };
			(provider as any)._cacheByKey.set(key, entry);
			(provider as any)._lastGoodCacheByKey.set(key, entry);
		}

		const first = await provider.provideLanguageModelChatInformation(
			{ silent: true, configuration: { apiKey: "sk-a" } } as any,
			token as any
		);
		const second = await provider.provideLanguageModelChatInformation(
			{ silent: true, configuration: { apiKey: "sk-b" } } as any,
			token as any
		);

		assert.equal((provider as any)._modelCredentials.get(first[0]).apiKey, "sk-a");
		assert.equal((provider as any)._modelCredentials.get(second[0]).apiKey, "sk-b");
		assert.deepEqual(
			[...((provider as any)._providerGroups as Map<string, unknown>).keys()],
			["cache-sk-a", "cache-sk-b"]
		);
	});

	it("disambiguates credential-scoped caches when base cache keys collide", async () => {
		const { InfiniAIChatModelProvider } = loadProvider();
		const provider = new InfiniAIChatModelProvider("test-agent", {} as any, { appendLine() {} } as any);
		const info = { id: "test-model" };
		(provider as any).buildCacheKey = () => "colliding-cache-key";
		const firstKey = (provider as any).resolveCacheKey("sk-a");
		const secondKey = (provider as any).resolveCacheKey("sk-b");
		assert.equal(firstKey, "colliding-cache-key");
		assert.notEqual(secondKey, firstKey);
		assert.equal((provider as any).resolveCacheKey("sk-a"), firstKey);
		assert.equal((provider as any).resolveCacheKey("sk-b"), secondKey);
		for (const key of [firstKey, secondKey]) {
			const entry = { ...cacheEntry(key, Date.now()), infos: [info] };
			(provider as any)._cacheByKey.set(key, entry);
			(provider as any)._lastGoodCacheByKey.set(key, entry);
		}

		const first = await provider.provideLanguageModelChatInformation(
			{ silent: true, configuration: { apiKey: "sk-a" } } as any,
			token as any
		);
		const second = await provider.provideLanguageModelChatInformation(
			{ silent: true, configuration: { apiKey: "sk-b" } } as any,
			token as any
		);

		assert.equal((provider as any)._modelCredentials.get(first[0]).apiKey, "sk-a");
		assert.equal((provider as any)._modelCredentials.get(second[0]).apiKey, "sk-b");
		assert.deepEqual([...((provider as any)._providerGroups as Map<string, unknown>).keys()], [firstKey, secondKey]);
	});

	it("uses the model object's bound credential after another configuration is resolved", async () => {
		const { InfiniAIChatModelProvider } = loadProvider();
		const provider = new InfiniAIChatModelProvider("test-agent", {} as any, { appendLine() {} } as any);
		const info = { id: "test-model" };
		(provider as any).buildCacheKey = (apiKey: string) => `cache-${apiKey}`;
		for (const apiKey of ["sk-a", "sk-b"]) {
			const key = `cache-${apiKey}`;
			const entry = { ...cacheEntry(key, Date.now()), infos: [info] };
			(provider as any)._cacheByKey.set(key, entry);
			(provider as any)._lastGoodCacheByKey.set(key, entry);
		}

		const first = await provider.provideLanguageModelChatInformation(
			{ silent: true, configuration: { apiKey: "sk-a" } } as any,
			token as any
		);
		await provider.provideLanguageModelChatInformation(
			{ silent: true, configuration: { apiKey: "sk-b" } } as any,
			token as any
		);

		let cacheCredential: string | undefined;
		let requestCredential: string | undefined;
		(provider as any).getModelCache = async (apiKey: string) => {
			cacheCredential = apiKey;
			return {
				...cacheEntry(`cache-${apiKey}`, Date.now()),
				models: [{ id: "test-model" }],
				routes: new Map([
					[
						"test-model",
						{
							transport: "openai",
							baseUrl: "https://example.test/v1",
							endpointKind: "chat-completions",
							source: "default",
						},
					],
				]),
			};
		};
		(provider as any).runOpenAIRequest = async (
			_model: unknown,
			_messages: unknown,
			_options: unknown,
			_progress: unknown,
			_token: unknown,
			apiKey: string
		) => {
			requestCredential = apiKey;
		};

		await provider.provideLanguageModelChatResponse(
			first[0] as any,
			[],
			{} as any,
			{ report() {} } as any,
			token as any
		);

		assert.equal(cacheCredential, "sk-a");
		assert.equal(requestCredential, "sk-a");
	});

	it("refreshes an expired silent discovery cache instead of pinning last-good data forever", async () => {
		const { InfiniAIChatModelProvider } = loadProvider();
		const provider = new InfiniAIChatModelProvider("test-agent", {} as any, { appendLine() {} } as any);
		const stale = cacheEntry("cache-key", Date.now() - 1000);
		const fresh = cacheEntry("cache-key", Date.now());
		(provider as any).buildCacheKey = () => "cache-key";
		(provider as any).getCacheTtlMs = () => 10;
		(provider as any)._cacheByKey.set("cache-key", stale);
		(provider as any)._lastGoodCacheByKey.set("cache-key", stale);
		let fetches = 0;
		(provider as any).fetchAndNormalizeModels = async () => {
			fetches++;
			return fresh;
		};

		const result = await (provider as any).getModelCache("sk-test", true, token);

		assert.equal(result, fresh);
		assert.equal(fetches, 1);
	});

	it("uses matching last-good data when a foreground refresh fails", async () => {
		const { InfiniAIChatModelProvider } = loadProvider();
		const provider = new InfiniAIChatModelProvider("test-agent", {} as any, { appendLine() {} } as any);
		const stale = cacheEntry("cache-key", Date.now() - 1000);
		(provider as any).buildCacheKey = () => "cache-key";
		(provider as any).getCacheTtlMs = () => 10;
		(provider as any)._lastGoodCacheByKey.set("cache-key", stale);
		(provider as any).fetchAndNormalizeModels = async () => {
			throw new Error("discovery unavailable");
		};

		const result = await (provider as any).getModelCache("sk-test", false, token);

		assert.equal(result, stale);
		assert.match((provider as any)._modelDiscoveryFailures.get("cache-key").error.message, /discovery unavailable/);
	});

	it("serves stale request metadata immediately while refreshing it silently", async () => {
		const { InfiniAIChatModelProvider } = loadProvider();
		const provider = new InfiniAIChatModelProvider("test-agent", {} as any, { appendLine() {} } as any);
		const stale = cacheEntry("cache-key", Date.now() - 1000);
		const fresh = cacheEntry("cache-key", Date.now());
		(provider as any).buildCacheKey = () => "cache-key";
		(provider as any).getCacheTtlMs = () => 10;
		(provider as any)._cacheByKey.set("cache-key", stale);
		(provider as any)._lastGoodCacheByKey.set("cache-key", stale);
		let fetches = 0;
		(provider as any).fetchAndNormalizeModels = async () => {
			fetches++;
			return fresh;
		};

		const result = await (provider as any).getModelCache("sk-test", false, token, false, true);
		await Promise.resolve();

		assert.equal(result, stale);
		assert.equal(fetches, 1);
	});

	it("starts one background discovery for many concurrent VS Code resolutions", async () => {
		const { InfiniAIChatModelProvider } = loadProvider();
		const provider = new InfiniAIChatModelProvider("test-agent", {} as any, { appendLine() {} } as any);
		(provider as any).buildCacheKey = () => "cache-key";
		let resolveFetch!: (entry: ReturnType<typeof cacheEntry>) => void;
		let fetches = 0;
		(provider as any).fetchAndNormalizeModels = async () => {
			fetches++;
			return await new Promise<ReturnType<typeof cacheEntry>>((resolve) => {
				resolveFetch = resolve;
			});
		};

		const results = await Promise.all(
			Array.from({ length: 20 }, () =>
				provider.provideLanguageModelChatInformation(
					{ silent: true, configuration: { apiKey: "sk-group" } } as any,
					token as any
				)
			)
		);

		assert.equal(fetches, 1);
		assert.ok(results.every((result) => result.length === 0));
		resolveFetch(cacheEntry("cache-key", Date.now()));
		await (provider as any)._modelDiscoveryOperations.get("cache-key").promise;
	});

	it("reuses a cached discovery failure without issuing another request during cooldown", async () => {
		const { InfiniAIChatModelProvider } = loadProvider();
		const provider = new InfiniAIChatModelProvider("test-agent", {} as any, { appendLine() {} } as any);
		(provider as any).buildCacheKey = () => "cache-key";
		let fetches = 0;
		(provider as any).fetchAndNormalizeModels = async () => {
			fetches++;
			return cacheEntry("cache-key", Date.now());
		};
		(provider as any).recordDiscoveryFailure("cache-key", new Error("discovery unavailable"));

		const results = await Promise.allSettled(
			Array.from({ length: 20 }, () =>
				provider.provideLanguageModelChatInformation(
					{ silent: true, configuration: { apiKey: "sk-group" } } as any,
					token as any
				)
			)
		);

		assert.equal(fetches, 0);
		assert.ok(results.every((result) => result.status === "rejected"));
	});

	it("starts a background retry when a discovery cooldown expires", async () => {
		const { InfiniAIChatModelProvider } = loadProvider();
		const provider = new InfiniAIChatModelProvider("test-agent", {} as any, { appendLine() {} } as any);
		(provider as any)._providerGroups.set("cache-key", {
			name: "Provider configuration 1",
			apiKey: "sk-group",
			cacheKey: "cache-key",
		});
		(provider as any)._modelDiscoveryFailures.set("cache-key", {
			error: new Error("discovery unavailable"),
			category: "network",
			failedAt: Date.now(),
			retryAt: Date.now(),
			failureCount: 1,
		});
		let retries = 0;
		(provider as any).ensureBackgroundDiscovery = () => retries++;

		(provider as any).scheduleModelDiscoveryRetry("cache-key", Date.now());
		await new Promise((resolve) => setTimeout(resolve, 0));

		assert.equal(retries, 1);
		assert.equal((provider as any)._modelDiscoveryRetryTimers.size, 0);
	});

	it("does not fire a provider change event when refreshed metadata is unchanged", async () => {
		const { InfiniAIChatModelProvider } = loadProvider();
		const provider = new InfiniAIChatModelProvider("test-agent", {} as any, { appendLine() {} } as any);
		const previous = cacheEntry("cache-key", Date.now() - 1000);
		const refreshed = cacheEntry("cache-key", Date.now());
		(provider as any).buildCacheKey = () => "cache-key";
		(provider as any)._lastGoodCacheByKey.set("cache-key", previous);
		(provider as any).fetchAndNormalizeModels = async () => refreshed;
		let changes = 0;
		provider.onDidChangeLanguageModelChatInformation(() => changes++);

		await (provider as any).getModelCache("sk-test", false, token, true);

		assert.equal(changes, 0);
	});

	it("aborts the active discovery when models are invalidated", async () => {
		const { InfiniAIChatModelProvider } = loadProvider();
		const provider = new InfiniAIChatModelProvider("test-agent", {} as any, { appendLine() {} } as any);
		(provider as any).buildCacheKey = () => "cache-key";
		let observedToken: any;
		(provider as any).fetchAndNormalizeModels = async (_apiKey: string, _key: string, fetchToken: any) => {
			observedToken = fetchToken;
			return await new Promise(() => undefined);
		};

		await provider.provideLanguageModelChatInformation(
			{ silent: true, configuration: { apiKey: "sk-group" } } as any,
			token as any
		);
		assert.equal(observedToken.isCancellationRequested, false);

		provider.refreshModels();

		assert.equal(observedToken.isCancellationRequested, true);
		assert.equal((provider as any)._modelDiscoveryOperations.size, 0);
	});
});
