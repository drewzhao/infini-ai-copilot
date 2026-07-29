import assert from "assert/strict";

const Module = require("module") as any;

function loadUtils() {
	const originalLoad = Module._load;
	class TestCancellationError extends Error {}
	const vscodeMock = {
		CancellationError: TestCancellationError,
		workspace: {
			getConfiguration: () => ({
				get: (_key: string, defaultValue?: unknown) => defaultValue,
			}),
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
			TestCancellationError,
		};
	} finally {
		Module._load = originalLoad;
	}
}

function neverCancelledToken() {
	return {
		isCancellationRequested: false,
		onCancellationRequested: () => ({ dispose() {} }),
	};
}

function abortError(): Error {
	const error = new Error("aborted");
	error.name = "AbortError";
	return error;
}

describe("model discovery transport", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("times out while waiting for response headers", async () => {
		const { utils } = loadUtils();
		globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
			return await new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => reject(abortError()));
			});
		}) as typeof fetch;

		await assert.rejects(
			utils.fetchWithCancellationAndTimeout(
				"https://example.test/models",
				{},
				neverCancelledToken() as any,
				20,
				async () => ({})
			),
			(err: unknown) => err instanceof utils.RequestTimeoutError
		);
	});

	it("keeps the deadline active while consuming the response body", async () => {
		const { utils } = loadUtils();
		let signal: AbortSignal | null | undefined;
		globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
			signal = init?.signal;
			return {} as Response;
		}) as typeof fetch;

		await assert.rejects(
			utils.fetchWithCancellationAndTimeout(
				"https://example.test/models",
				{},
				neverCancelledToken() as any,
				20,
				async () =>
					await new Promise((_resolve, reject) => {
						signal?.addEventListener("abort", () => reject(abortError()));
					})
			),
			(err: unknown) => err instanceof utils.RequestTimeoutError
		);
	});

	it("reports user cancellation instead of a timeout during body consumption", async () => {
		const { utils, TestCancellationError } = loadUtils();
		const listeners = new Set<() => void>();
		const token = {
			isCancellationRequested: false,
			onCancellationRequested: (listener: () => void) => {
				listeners.add(listener);
				return { dispose: () => listeners.delete(listener) };
			},
		};
		let signal: AbortSignal | null | undefined;
		globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
			signal = init?.signal;
			return {} as Response;
		}) as typeof fetch;
		const request = utils.fetchWithCancellationAndTimeout(
			"https://example.test/models",
			{},
			token as any,
			1000,
			async () =>
				await new Promise((_resolve, reject) => {
					signal?.addEventListener("abort", () => reject(abortError()));
				})
		);

		await Promise.resolve();
		await Promise.resolve();
		token.isCancellationRequested = true;
		for (const listener of listeners) {
			listener();
		}

		await assert.rejects(request, (err: unknown) => err instanceof TestCancellationError);
	});
});
