#!/usr/bin/env node
// Local capture proxy for diagnosing InfiniAI request rejections.
//
// Usage:
//   node scripts/capture-proxy.mjs [--port 8788] [--target https://cloud.infini-ai.com/maas/v1] [--out ~/.infiniai-captures]
//
// Then set the VS Code setting:
//   "infiniai.baseUrl": "http://127.0.0.1:8788"
// reproduce the failing chat turn, and restore the setting afterwards.
//
// Every POST body is saved to the output directory (Authorization headers are
// forwarded but never written to disk). Non-2xx upstream responses are saved
// next to the request capture for later replay with scripts/replay-capture.mjs.

import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

function arg(name, fallback) {
	const index = process.argv.indexOf(name);
	return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const port = Number(arg("--port", "8788"));
const target = arg("--target", "https://cloud.infini-ai.com/maas/v1").replace(/\/$/, "");
const outDir = arg("--out", path.join(homedir(), ".infiniai-captures"));
mkdirSync(outDir, { recursive: true });

let seq = 0;

function summarize(bodyText) {
	try {
		const body = JSON.parse(bodyText);
		const messages = Array.isArray(body.messages) ? body.messages.length : 0;
		return `model=${body.model ?? "?"} messages=${messages} stream=${body.stream === true}`;
	} catch {
		return `bytes=${bodyText.length}`;
	}
}

const server = createServer(async (req, res) => {
	const chunks = [];
	for await (const chunk of req) {
		chunks.push(chunk);
	}
	const bodyText = Buffer.concat(chunks).toString("utf8");
	const stamp = `${Date.now()}-${++seq}`;
	const captureFile = path.join(outDir, `${stamp}.json`);
	if (req.method === "POST" && bodyText) {
		writeFileSync(captureFile, bodyText, "utf8");
	}

	const url = `${target}${req.url}`;
	let upstream;
	try {
		upstream = await fetch(url, {
			method: req.method,
			headers: {
				"Content-Type": req.headers["content-type"] ?? "application/json",
				...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
				...(req.headers.accept ? { Accept: req.headers.accept } : {}),
			},
			body: req.method === "POST" || req.method === "PUT" ? bodyText : undefined,
		});
	} catch (err) {
		console.log(`[proxy] ${req.method} ${req.url} -> fetch error: ${err.message}`);
		res.writeHead(502, { "Content-Type": "text/plain" });
		res.end(`capture-proxy fetch error: ${err.message}`);
		return;
	}

	const headers = {};
	upstream.headers.forEach((value, key) => {
		if (!["content-length", "content-encoding", "transfer-encoding", "connection"].includes(key.toLowerCase())) {
			headers[key] = value;
		}
	});
	res.writeHead(upstream.status, headers);

	if (upstream.ok && upstream.body) {
		for await (const chunk of upstream.body) {
			res.write(chunk);
		}
		res.end();
	} else {
		const errorText = await upstream.text();
		if (req.method === "POST" && bodyText) {
			writeFileSync(path.join(outDir, `${stamp}.response.txt`), `HTTP ${upstream.status}\n${errorText}`, "utf8");
		}
		res.end(errorText);
	}

	const marker = upstream.ok ? "" : `  !! saved ${stamp}.json + ${stamp}.response.txt`;
	console.log(
		`[proxy] ${new Date().toISOString()} ${req.method} ${req.url} ${summarize(bodyText)} -> ${upstream.status}${marker}`
	);
});

server.listen(port, "127.0.0.1", () => {
	console.log(`capture-proxy listening on http://127.0.0.1:${port}`);
	console.log(`forwarding to ${target}`);
	console.log(`captures in ${outDir}`);
	console.log(`VS Code setting: "infiniai.baseUrl": "http://127.0.0.1:${port}"`);
});
