import assert from "assert/strict";

const Module = require("module") as any;

class TestCancellationError extends Error {
	constructor() {
		super("Canceled");
		this.name = "CancellationError";
	}
}

function loadUtils(configValues: Record<string, unknown>) {
	const originalLoad = Module._load;
	const vscodeMock = {
		CancellationError: TestCancellationError,
		workspace: {
			getConfiguration: () => ({
				get: (key: string, defaultValue?: unknown) => configValues[key] ?? defaultValue,
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
		return require("./utils") as typeof import("./utils");
	} finally {
		Module._load = originalLoad;
	}
}

function token(cancelled = false) {
	return {
		get isCancellationRequested() {
			return cancelled;
		},
		onCancellationRequested: () => ({ dispose() {} }),
	};
}

describe("retry configuration", () => {
	it("reads infiniai.retry", () => {
		const utils = loadUtils({
			"infiniai.retry": {
				enabled: false,
				max_attempts: 7,
				interval_ms: 12,
				status_codes: [418],
			},
		});

		assert.deepEqual(utils.createRetryConfig(), {
			enabled: false,
			max_attempts: 7,
			interval_ms: 12,
			status_codes: [418],
		});
	});

	it("treats max_attempts as total attempts", async () => {
		const utils = loadUtils({
			"infiniai.retry": {
				enabled: true,
				max_attempts: 3,
				interval_ms: 1,
			},
		});
		let attempts = 0;

		await assert.rejects(
			() =>
				utils.executeWithRetry(
					async () => {
						attempts += 1;
						throw new utils.HttpError(429, "Too Many Requests", "");
					},
					utils.createRetryConfig(),
					token() as any
				),
			/HTTP 429/
		);
		assert.equal(attempts, 3);
	});

	it("does not retry non-retryable HTTP errors", async () => {
		const utils = loadUtils({
			"infiniai.retry": {
				enabled: true,
				max_attempts: 3,
				interval_ms: 1,
			},
		});
		let attempts = 0;

		await assert.rejects(
			() =>
				utils.executeWithRetry(
					async () => {
						attempts += 1;
						throw new utils.HttpError(401, "Unauthorized", "");
					},
					utils.createRetryConfig(),
					token() as any
				),
			/HTTP 401/
		);
		assert.equal(attempts, 1);
	});

	it("retries HTTP 408 by default", async () => {
		const utils = loadUtils({
			"infiniai.retry": {
				enabled: true,
				max_attempts: 2,
				interval_ms: 1,
			},
		});
		let attempts = 0;

		await assert.rejects(
			() =>
				utils.executeWithRetry(
					async () => {
						attempts += 1;
						throw new utils.HttpError(408, "Request Timeout", "");
					},
					utils.createRetryConfig(),
					token() as any
				),
			/HTTP 408/
		);
		assert.equal(attempts, 2);
	});

	it("does not retry provider protocol errors", async () => {
		const utils = loadUtils({
			"infiniai.retry": {
				enabled: true,
				max_attempts: 3,
				interval_ms: 1,
			},
		});
		let attempts = 0;

		await assert.rejects(
			() =>
				utils.executeWithRetry(
					async () => {
						attempts += 1;
						throw new utils.ProviderProtocolError("bad stream");
					},
					utils.createRetryConfig(),
					token() as any
				),
			/bad stream/
		);
		assert.equal(attempts, 1);
	});
});
