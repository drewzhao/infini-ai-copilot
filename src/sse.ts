import * as vscode from "vscode";

export interface SseEvent {
	data: string;
	event?: string;
	id?: string;
}

function parseEventBlock(block: string): SseEvent | undefined {
	const dataLines: string[] = [];
	let event: string | undefined;
	let id: string | undefined;
	for (const rawLine of block.split(/\r?\n/)) {
		const line = rawLine.trimEnd();
		if (!line || line.startsWith(":")) {
			continue;
		}
		const separator = line.indexOf(":");
		const field = separator === -1 ? line : line.slice(0, separator);
		const rawValue = separator === -1 ? "" : line.slice(separator + 1);
		const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
		if (field === "data") {
			dataLines.push(value);
		} else if (field === "event") {
			event = value;
		} else if (field === "id") {
			id = value;
		}
	}
	if (dataLines.length === 0) {
		return undefined;
	}
	return { data: dataLines.join("\n"), event, id };
}

function splitCompleteBlocks(buffer: string, flush: boolean): { events: SseEvent[]; remainder: string } {
	const events: SseEvent[] = [];
	const parts = buffer.split(/\r?\n\r?\n/);
	const remainder = flush ? "" : (parts.pop() ?? "");
	const completeParts = flush ? parts : parts;
	for (const part of completeParts) {
		const event = parseEventBlock(part);
		if (event) {
			events.push(event);
		}
	}
	if (flush && parts.length === 0 && buffer.trim()) {
		const event = parseEventBlock(buffer);
		if (event) {
			events.push(event);
		}
	}
	return { events, remainder };
}

export async function* readSseEvents(
	responseBody: ReadableStream<Uint8Array>,
	token: vscode.CancellationToken
): AsyncGenerator<SseEvent> {
	const reader = responseBody.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	const cancellation = token.onCancellationRequested(() => {
		void reader.cancel();
	});
	try {
		while (true) {
			if (token.isCancellationRequested) {
				throw new vscode.CancellationError();
			}
			const { done, value } = await reader.read();
			if (done) {
				buffer += decoder.decode();
				const { events } = splitCompleteBlocks(buffer, true);
				for (const event of events) {
					yield event;
				}
				break;
			}
			buffer += decoder.decode(value, { stream: true });
			const parsed = splitCompleteBlocks(buffer, false);
			buffer = parsed.remainder;
			for (const event of parsed.events) {
				yield event;
			}
		}
	} finally {
		cancellation.dispose();
		reader.releaseLock();
	}
}
