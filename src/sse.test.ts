import assert from "assert/strict";

const Module = require("module") as any;

class TestCancellationError extends Error {
	constructor() {
		super("Canceled");
		this.name = "CancellationError";
	}
}

function loadSse() {
	const originalLoad = Module._load;
	delete require.cache[require.resolve("./sse")];
	Module._load = (request: string, parent: unknown, isMain: boolean) => {
		if (request === "vscode") {
			return { CancellationError: TestCancellationError };
		}
		return originalLoad(request, parent, isMain);
	};
	try {
		return require("./sse") as typeof import("./sse");
	} finally {
		Module._load = originalLoad;
	}
}

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(chunk));
			}
			controller.close();
		},
	});
}

function token(cancelled = false) {
	return {
		get isCancellationRequested() {
			return cancelled;
		},
		onCancellationRequested: () => ({ dispose() {} }),
	};
}

describe("readSseEvents", () => {
	it("handles split chunks and final data without trailing newline", async () => {
		const { readSseEvents } = loadSse();
		const events = [];
		for await (const event of readSseEvents(
			streamFromChunks(['data: {"a', '":1}\n\n', "data: [DONE]"]),
			token() as any
		)) {
			events.push(event.data);
		}

		assert.deepEqual(events, ['{"a":1}', "[DONE]"]);
	});

	it("joins multi-line data blocks", async () => {
		const { readSseEvents } = loadSse();
		const events = [];
		for await (const event of readSseEvents(
			streamFromChunks(["event: message\ndata: one\ndata: two\n\n"]),
			token() as any
		)) {
			events.push(event);
		}

		assert.deepEqual(events, [{ data: "one\ntwo", event: "message", id: undefined }]);
	});
});
