#!/usr/bin/env node
// Replay a captured chat-completions request body against the InfiniAI
// gateway, optionally bisecting the message history down to a minimal failing
// subset.
//
// Usage:
//   export CHAT_COMPLETIONS_API_KEY=...   (or GENSTUDIO_API_KEY)
//   node scripts/replay-capture.mjs <capture.json> [--times 6] [--bisect] \
//     [--base-url https://cloud.infini-ai.com/maas/v1] [--no-stream]
//
// The gateway load-balances kimi-k3 across more than one backing cluster, so
// a single 200 does not prove acceptance: every candidate is tried --times
// times and counts as failing if any attempt is rejected. Output prints only
// message skeletons (roles, lengths, tool ids), never message text.

import { readFileSync } from "node:fs";

function arg(name, fallback) {
	const index = process.argv.indexOf(name);
	return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const captureFile = process.argv[2];
if (!captureFile || captureFile.startsWith("--")) {
	console.error("usage: node scripts/replay-capture.mjs <capture.json> [--times 6] [--bisect] [--no-stream]");
	process.exit(1);
}
const times = Number(arg("--times", "6"));
const bisect = process.argv.includes("--bisect");
const noStream = process.argv.includes("--no-stream");
const baseUrl = arg("--base-url", "https://cloud.infini-ai.com/maas/v1").replace(/\/$/, "");
const apiKey = process.env.CHAT_COMPLETIONS_API_KEY || process.env.GENSTUDIO_API_KEY;
if (!apiKey) {
	console.error("CHAT_COMPLETIONS_API_KEY or GENSTUDIO_API_KEY is required.");
	process.exit(1);
}

const original = JSON.parse(readFileSync(captureFile, "utf8"));
if (noStream) {
	original.stream = false;
	delete original.stream_options;
}

function skeleton(message) {
	const contentChars =
		typeof message.content === "string"
			? message.content.length
			: Array.isArray(message.content)
				? JSON.stringify(message.content).length
				: -1;
	const reasoning = typeof message.reasoning_content === "string" ? `+rc${message.reasoning_content.length}` : "";
	const toolCalls =
		Array.isArray(message.tool_calls) && message.tool_calls.length > 0
			? `+tc[${message.tool_calls.map((toolCall) => toolCall.id || "<empty>").join(",")}]`
			: "";
	const toolCallId = message.tool_call_id !== undefined ? `@${message.tool_call_id || "<empty>"}` : "";
	return `${message.role}:${contentChars}${reasoning}${toolCalls}${toolCallId}`;
}

async function sendOnce(body) {
	const response = await fetch(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
		body: JSON.stringify(body),
	});
	const text = await response.text();
	let backendModel = "?";
	try {
		backendModel = JSON.parse(text).model ?? "?";
	} catch {
		const match = text.match(/"model"\s*:\s*"([^"]+)"/);
		if (match) {
			backendModel = match[1];
		}
	}
	return { status: response.status, backendModel, text };
}

async function probeBody(body, label) {
	let failures = 0;
	let lastFailure;
	for (let i = 0; i < times; i++) {
		const result = await sendOnce(body);
		const ok = result.status >= 200 && result.status < 300;
		if (!ok) {
			failures++;
			lastFailure = result;
		}
		console.log(
			`  [${label}] try ${i + 1}/${times}: status=${result.status} backend=${result.backendModel}` +
				(ok ? "" : ` error=${result.text.slice(0, 160).replace(/\s+/g, " ")}`)
		);
	}
	return { failing: failures > 0, failures, lastFailure };
}

function withMessages(body, messages) {
	return { ...body, messages };
}

(async () => {
	console.log(`replaying ${captureFile}: model=${original.model} messages=${original.messages?.length ?? 0}`);
	const baseline = await probeBody(original, "full");
	if (!baseline.failing) {
		console.log("Full capture was accepted on every attempt; nothing to bisect.");
		return;
	}
	console.log(`Full capture failed ${baseline.failures}/${times} attempts.`);
	if (!bisect) {
		return;
	}

	// Greedy chunk elimination: repeatedly try dropping message spans while the
	// remaining request still fails. Tool-pairing breakage is fine — the
	// gateway accepts orphan tool messages (probed 2026-09-21).
	let messages = [...original.messages];
	let chunk = Math.max(1, Math.floor(messages.length / 2));
	while (chunk >= 1) {
		let removedAny = false;
		for (let start = 0; start + chunk <= messages.length && messages.length > 1; ) {
			const candidate = [...messages.slice(0, start), ...messages.slice(start + chunk)];
			const result = await probeBody(withMessages(original, candidate), `drop ${start}..${start + chunk - 1} of ${messages.length}`);
			if (result.failing) {
				messages = candidate;
				removedAny = true;
			} else {
				start += chunk;
			}
		}
		if (!removedAny || chunk === 1) {
			if (chunk === 1) {
				break;
			}
		}
		chunk = Math.floor(chunk / 2);
	}

	console.log(`\nMinimal failing subset: ${messages.length} message(s)`);
	messages.forEach((message, index) => console.log(`  m[${index}] ${skeleton(message)}`));
	const final = await probeBody(withMessages(original, messages), "minimal");
	console.log(
		final.lastFailure
			? `\nLast failure: status=${final.lastFailure.status} body=${final.lastFailure.text.slice(0, 400)}`
			: "\nMinimal subset unexpectedly stopped failing; rerun with a higher --times."
	);
})();
