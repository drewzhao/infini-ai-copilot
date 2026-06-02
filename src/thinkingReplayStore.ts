import { randomUUID } from "crypto";
import { mkdir, readFile, rename, rm, writeFile } from "fs/promises";
import { dirname } from "path";

import type { ReplayCarrier } from "./reasoningDialect";
import type { ModelTransport } from "./types";

export type StoredReplayCarrier = Exclude<ReplayCarrier, "none" | "unknown">;

export interface ThinkingReplayEntry {
	readonly modelId: string;
	readonly callId: string;
	readonly profileId?: string;
	readonly transport?: ModelTransport;
	readonly carrier?: StoredReplayCarrier;
	readonly reasoningContent?: string;
	readonly reasoningDetails?: readonly unknown[];
	readonly reasoningSignature?: string;
	readonly redactedThinkingData?: string;
	readonly observedWithoutReplayPayload?: boolean;
	readonly capturedAt: number;
	readonly byteLength: number;
}

export interface PendingThinkingTurn {
	readonly turnId: string;
	readonly modelId: string;
}

export interface BeginThinkingReplayTurnInput {
	readonly modelId: string;
	readonly profileId: string;
	readonly transport: ModelTransport;
	readonly carrier: StoredReplayCarrier;
}

export interface ThinkingReplayLookupInput {
	readonly modelId: string;
	readonly callId: string;
	readonly profileId: string;
	readonly carrier: StoredReplayCarrier;
}

export interface ThinkingReplayStats {
	readonly entryCount: number;
	readonly totalBytes: number;
	readonly pendingCount: number;
}

export interface ThinkingReplayStorage {
	load(): Promise<readonly ThinkingReplayEntry[]>;
	save(entries: readonly ThinkingReplayEntry[]): Promise<void>;
	clear(): Promise<void>;
}

export interface ThinkingReplayStoreOptions {
	readonly maxEntries?: number;
	readonly maxTotalBytes?: number;
	readonly maxPendingTurnBytes?: number;
	readonly ttlMs?: number;
	readonly now?: () => number;
}

interface PendingTurn {
	readonly modelId: string;
	readonly profileId: string;
	readonly transport: ModelTransport;
	readonly carrier: StoredReplayCarrier;
	readonly callIds: Set<string>;
	readonly chunks: string[];
	readonly detailChunks: unknown[];
	readonly signatureChunks: string[];
	readonly redactedThinkingChunks: string[];
	byteLength: number;
	invalid: boolean;
}

const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_PENDING_TURN_BYTES = 512 * 1024;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function replayKey(modelId: string, callId: string): string {
	return `${modelId}::${callId}`;
}

function byteLength(input: string): number {
	return Buffer.byteLength(input, "utf8");
}

export function isStoredReplayCarrier(value: ReplayCarrier): value is StoredReplayCarrier {
	return (
		value === "reasoning_content" ||
		value === "reasoning_details" ||
		value === "think_tag_content" ||
		value === "anthropic_thinking_block"
	);
}

function isReplayEntry(value: unknown): value is ThinkingReplayEntry {
	const v = value as Partial<ThinkingReplayEntry> | undefined;
	return (
		!!v &&
		typeof v.modelId === "string" &&
		typeof v.callId === "string" &&
		(v.profileId === undefined || typeof v.profileId === "string") &&
		(v.transport === undefined ||
			v.transport === "openai" ||
			v.transport === "anthropic" ||
			v.transport === "vertex") &&
		(v.carrier === undefined || isStoredReplayCarrier(v.carrier)) &&
		(v.reasoningContent === undefined || typeof v.reasoningContent === "string") &&
		(v.reasoningDetails === undefined || Array.isArray(v.reasoningDetails)) &&
		(v.reasoningSignature === undefined || typeof v.reasoningSignature === "string") &&
		(v.redactedThinkingData === undefined || typeof v.redactedThinkingData === "string") &&
		(v.observedWithoutReplayPayload === undefined || v.observedWithoutReplayPayload === true) &&
		typeof v.capturedAt === "number" &&
		typeof v.byteLength === "number" &&
		v.modelId.length > 0 &&
		v.callId.length > 0 &&
		v.byteLength >= 0 &&
		(typeof v.reasoningContent === "string" ||
			Array.isArray(v.reasoningDetails) ||
			typeof v.redactedThinkingData === "string" ||
			v.observedWithoutReplayPayload === true)
	);
}

function normalizeReplayEntry(entry: ThinkingReplayEntry): ThinkingReplayEntry {
	const carrier = entry.carrier ?? "reasoning_content";
	return {
		...entry,
		profileId: entry.profileId ?? "legacy-reasoning-content",
		transport: entry.transport ?? "openai",
		carrier,
	};
}

export class MemoryThinkingReplayStorage implements ThinkingReplayStorage {
	async load(): Promise<readonly ThinkingReplayEntry[]> {
		return [];
	}

	async save(_entries: readonly ThinkingReplayEntry[]): Promise<void> {
		// Intentionally no-op: this backend keeps replay state process-local.
	}

	async clear(): Promise<void> {
		// Intentionally no-op.
	}
}

export class LocalPlaintextThinkingReplayStorage implements ThinkingReplayStorage {
	constructor(private readonly storageFile: string | { fsPath?: string; path?: string }) {}

	async load(): Promise<readonly ThinkingReplayEntry[]> {
		try {
			const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as { entries?: unknown };
			return Array.isArray(parsed.entries) ? parsed.entries.filter(isReplayEntry) : [];
		} catch {
			return [];
		}
	}

	async save(entries: readonly ThinkingReplayEntry[]): Promise<void> {
		await mkdir(dirname(this.filePath), { recursive: true });
		const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
		const payload = JSON.stringify({ version: 1, entries }, null, "\t");
		await writeFile(tempPath, payload, "utf8");
		await rename(tempPath, this.filePath);
	}

	async clear(): Promise<void> {
		await rm(this.filePath, { force: true });
	}

	private get filePath(): string {
		if (typeof this.storageFile === "string") {
			return this.storageFile;
		}
		return this.storageFile.fsPath ?? this.storageFile.path ?? "";
	}
}

export class ThinkingReplayStore {
	private readonly maxEntries: number;
	private readonly maxTotalBytes: number;
	private readonly maxPendingTurnBytes: number;
	private readonly ttlMs: number;
	private readonly now: () => number;
	private readonly entries = new Map<string, ThinkingReplayEntry>();
	private readonly pending = new Map<string, PendingTurn>();
	private storage: ThinkingReplayStorage = new MemoryThinkingReplayStorage();

	constructor(options: ThinkingReplayStoreOptions = {}) {
		this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
		this.maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
		this.maxPendingTurnBytes = options.maxPendingTurnBytes ?? DEFAULT_MAX_PENDING_TURN_BYTES;
		this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
		this.now = options.now ?? (() => Date.now());
	}

	async initialize(storage: ThinkingReplayStorage): Promise<void> {
		this.storage = storage;
		this.entries.clear();
		const loaded = await storage.load();
		for (const entry of loaded) {
			const normalized = normalizeReplayEntry(entry);
			this.entries.set(replayKey(normalized.modelId, normalized.callId), normalized);
		}
		await this.prune();
	}

	beginTurn(modelId: string): PendingThinkingTurn;
	beginTurn(input: BeginThinkingReplayTurnInput): PendingThinkingTurn;
	beginTurn(input: string | BeginThinkingReplayTurnInput): PendingThinkingTurn {
		const config =
			typeof input === "string"
				? {
						modelId: input,
						profileId: "legacy-reasoning-content",
						transport: "openai" as const,
						carrier: "reasoning_content" as const,
					}
				: input;
		const turnId = randomUUID();
		this.pending.set(turnId, {
			modelId: config.modelId,
			profileId: config.profileId,
			transport: config.transport,
			carrier: config.carrier,
			callIds: new Set<string>(),
			chunks: [],
			detailChunks: [],
			signatureChunks: [],
			redactedThinkingChunks: [],
			byteLength: 0,
			invalid: !config.modelId || !config.profileId,
		});
		return { turnId, modelId: config.modelId };
	}

	appendReasoning(turnId: string, text: string): void {
		this.appendReasoningText(turnId, text);
	}

	appendReasoningText(turnId: string, text: string): void {
		if (!text) {
			return;
		}
		const pending = this.pending.get(turnId);
		if (!pending) {
			return;
		}
		pending.byteLength += byteLength(text);
		if (pending.byteLength > this.maxPendingTurnBytes) {
			pending.invalid = true;
			return;
		}
		pending.chunks.push(text);
	}

	appendReasoningDetails(turnId: string, details: readonly unknown[]): void {
		if (details.length === 0) {
			return;
		}
		const pending = this.pending.get(turnId);
		if (!pending) {
			return;
		}
		const serialized = JSON.stringify(details);
		pending.byteLength += byteLength(serialized);
		if (pending.byteLength > this.maxPendingTurnBytes) {
			pending.invalid = true;
			return;
		}
		pending.detailChunks.push(...details);
	}

	appendReasoningSignature(turnId: string, signature: string): void {
		if (!signature) {
			return;
		}
		const pending = this.pending.get(turnId);
		if (!pending) {
			return;
		}
		pending.signatureChunks.push(signature);
	}

	appendRedactedThinkingData(turnId: string, data: string): void {
		if (!data) {
			return;
		}
		const pending = this.pending.get(turnId);
		if (!pending) {
			return;
		}
		pending.byteLength += byteLength(data);
		if (pending.byteLength > this.maxPendingTurnBytes) {
			pending.invalid = true;
			return;
		}
		pending.redactedThinkingChunks.push(data);
	}

	recordToolCall(turnId: string, callId: string): void {
		const pending = this.pending.get(turnId);
		if (!pending) {
			return;
		}
		if (!callId) {
			pending.invalid = true;
			return;
		}
		pending.callIds.add(callId);
	}

	async commit(turnId: string): Promise<void> {
		const pending = this.pending.get(turnId);
		this.pending.delete(turnId);
		if (!pending || pending.invalid || pending.callIds.size === 0) {
			return;
		}

		const reasoningContent = pending.chunks.join("") || undefined;
		const reasoningDetails = pending.detailChunks.length > 0 ? [...pending.detailChunks] : undefined;
		const redactedThinkingData = pending.redactedThinkingChunks.join("") || undefined;
		const hasReplayPayload =
			pending.carrier === "reasoning_details" ? !!reasoningDetails : !!reasoningContent || !!redactedThinkingData;
		const observedWithoutReplayPayload =
			pending.carrier === "anthropic_thinking_block" && !hasReplayPayload ? true : undefined;
		if (!hasReplayPayload && !observedWithoutReplayPayload) {
			return;
		}
		const reasoningSignature = pending.signatureChunks.join("") || undefined;

		const capturedAt = this.now();
		const entryByteLength =
			(reasoningContent ? byteLength(reasoningContent) : 0) +
			(reasoningDetails ? byteLength(JSON.stringify(reasoningDetails)) : 0) +
			(reasoningSignature ? byteLength(reasoningSignature) : 0) +
			(redactedThinkingData ? byteLength(redactedThinkingData) : 0);
		for (const callId of pending.callIds) {
			const entry: ThinkingReplayEntry = {
				modelId: pending.modelId,
				callId,
				profileId: pending.profileId,
				transport: pending.transport,
				carrier: pending.carrier,
				reasoningContent,
				reasoningDetails,
				reasoningSignature,
				redactedThinkingData,
				observedWithoutReplayPayload,
				capturedAt,
				byteLength: entryByteLength,
			};
			this.entries.set(replayKey(entry.modelId, entry.callId), entry);
		}
		await this.prune(this.now(), true);
	}

	abort(turnId: string): void {
		this.pending.delete(turnId);
	}

	lookup(input: ThinkingReplayLookupInput): ThinkingReplayEntry | undefined;
	lookup(modelId: string, callId: string): ThinkingReplayEntry | undefined;
	lookup(inputOrModelId: string | ThinkingReplayLookupInput, callId?: string): ThinkingReplayEntry | undefined {
		const lookupInput = typeof inputOrModelId === "string" ? undefined : inputOrModelId;
		const keyModelId = typeof inputOrModelId === "string" ? inputOrModelId : inputOrModelId.modelId;
		const keyCallId = typeof inputOrModelId === "string" ? (callId ?? "") : inputOrModelId.callId;
		const entry = this.entries.get(replayKey(keyModelId, keyCallId));
		if (!entry || !this.isFresh(entry, this.now())) {
			if (entry) {
				this.entries.delete(replayKey(keyModelId, keyCallId));
			}
			return undefined;
		}
		if (lookupInput) {
			const normalized = normalizeReplayEntry(entry);
			if (normalized.carrier !== lookupInput.carrier) {
				return undefined;
			}
			if (normalized.profileId !== lookupInput.profileId && normalized.profileId !== "legacy-reasoning-content") {
				return undefined;
			}
			if (lookupInput.carrier !== "reasoning_content" && normalized.profileId === "legacy-reasoning-content") {
				return undefined;
			}
			return normalized;
		}
		return entry;
	}

	async prune(now = this.now(), forceSave = false): Promise<void> {
		const before = this.entries.size;
		for (const [key, entry] of this.entries) {
			if (!this.isFresh(entry, now)) {
				this.entries.delete(key);
			}
		}

		this.pruneByCount();
		this.pruneByBytes();
		if (forceSave || this.entries.size !== before) {
			await this.storage.save(this.snapshot());
		}
	}

	async clear(): Promise<void> {
		this.entries.clear();
		this.pending.clear();
		await this.storage.clear();
	}

	stats(): ThinkingReplayStats {
		return {
			entryCount: this.entries.size,
			totalBytes: this.snapshot().reduce((sum, entry) => sum + entry.byteLength, 0),
			pendingCount: this.pending.size,
		};
	}

	private isFresh(entry: ThinkingReplayEntry, now: number): boolean {
		return entry.capturedAt + this.ttlMs >= now;
	}

	private pruneByCount(): void {
		while (this.entries.size > this.maxEntries) {
			const oldest = this.oldestEntryKey();
			if (!oldest) {
				return;
			}
			this.entries.delete(oldest);
		}
	}

	private pruneByBytes(): void {
		while (this.stats().totalBytes > this.maxTotalBytes) {
			const oldest = this.oldestEntryKey();
			if (!oldest) {
				return;
			}
			this.entries.delete(oldest);
		}
	}

	private oldestEntryKey(): string | undefined {
		let oldestKey: string | undefined;
		let oldestCapturedAt = Number.POSITIVE_INFINITY;
		for (const [key, entry] of this.entries) {
			if (entry.capturedAt < oldestCapturedAt) {
				oldestKey = key;
				oldestCapturedAt = entry.capturedAt;
			}
		}
		return oldestKey;
	}

	private snapshot(): ThinkingReplayEntry[] {
		return [...this.entries.values()].sort((a, b) => a.capturedAt - b.capturedAt);
	}
}

export const thinkingReplayStore = new ThinkingReplayStore();
