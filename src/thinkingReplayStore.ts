import { createHash, randomUUID } from "crypto";
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "fs/promises";
import { dirname } from "path";

import type { OpenAIChatMessage } from "./openai/openaiTypes";
import type { ReplayCarrier } from "./reasoningDialect";
import type { ModelTransport } from "./types";

export type StoredReplayCarrier = Exclude<ReplayCarrier, "none" | "unknown">;

export interface ThinkingReplayEntry {
	readonly modelId: string;
	readonly callId?: string;
	/**
	 * All tool-call ids of one assistant turn sharing this payload. Parallel
	 * tool calls used to be stored as one duplicated entry per call id; the
	 * shared form stores (and counts) the payload once. `callId` remains for
	 * entries persisted by older versions.
	 */
	readonly callIds?: readonly string[];
	readonly assistantMessageKey?: string;
	readonly profileId?: string;
	readonly transport?: ModelTransport;
	readonly carrier?: StoredReplayCarrier;
	readonly reasoningContent?: string;
	readonly reasoningDetails?: readonly unknown[];
	readonly reasoningSignature?: string;
	readonly redactedThinkingData?: string;
	readonly observedWithoutReplayPayload?: boolean;
	readonly conflictingReplayPayload?: boolean;
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
	readonly historyKey?: string;
	readonly captureAssistantMessages?: boolean;
	readonly allowsMissingReplayPayload?: boolean;
}

export interface ThinkingReplayLookupInput {
	readonly modelId: string;
	readonly callId: string;
	readonly profileId: string;
	readonly carrier: StoredReplayCarrier;
}

export interface AssistantThinkingReplayLookupInput {
	readonly modelId: string;
	readonly assistantMessageKey: string;
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
	/** Persist newly committed entries without rewriting the whole store. */
	append(entries: readonly ThinkingReplayEntry[]): Promise<void>;
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
	readonly assistantContentChunks: string[];
	readonly historyKey?: string;
	readonly captureAssistantMessages: boolean;
	readonly allowsMissingReplayPayload: boolean;
	observedWithoutReplayPayload: boolean;
	byteLength: number;
	invalid: boolean;
}

const DEFAULT_MAX_ENTRIES = 2000;
const DEFAULT_MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_PENDING_TURN_BYTES = 512 * 1024;
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Full-rewrite compaction after this many appended lines since the last save. */
const COMPACTION_APPEND_THRESHOLD = 1024;

function callReplayKey(modelId: string, callId: string): string {
	return `call::${modelId}::${callId}`;
}

function assistantReplayKey(modelId: string, assistantMessageKey: string): string {
	return `assistant::${modelId}::${assistantMessageKey}`;
}

function byteLength(input: string): number {
	return Buffer.byteLength(input, "utf8");
}

function digest(input: string): string {
	return createHash("sha256").update(input).digest("hex");
}

function normalizeFingerprintText(input: string): string {
	return input.replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim();
}

function stableValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(stableValue);
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([key, entryValue]) => [key, stableValue(entryValue)])
		);
	}
	return value;
}

function normalizeToolArguments(input: string): unknown {
	try {
		return stableValue(JSON.parse(input));
	} catch {
		return normalizeFingerprintText(input);
	}
}

function canonicalOpenAIMessage(message: OpenAIChatMessage): Record<string, unknown> {
	const content =
		typeof message.content === "string"
			? normalizeFingerprintText(message.content)
			: Array.isArray(message.content)
				? message.content.map((part) => ({
						type: part.type,
						...(typeof part.text === "string" ? { text: normalizeFingerprintText(part.text) } : {}),
						...(part.image_url?.url ? { imageUrlDigest: digest(part.image_url.url) } : {}),
					}))
				: undefined;
	return {
		role: message.role,
		...(content !== undefined ? { content } : {}),
		...(message.name ? { name: message.name } : {}),
		...(message.tool_call_id ? { toolCallId: message.tool_call_id } : {}),
		...(message.tool_calls
			? {
					toolCalls: message.tool_calls.map((toolCall) => ({
						id: toolCall.id,
						type: toolCall.type,
						name: toolCall.function.name,
						arguments: normalizeToolArguments(toolCall.function.arguments),
					})),
				}
			: {}),
	};
}

export function buildOpenAIReplayHistoryKey(messages: readonly OpenAIChatMessage[]): string {
	return digest(JSON.stringify(messages.map(canonicalOpenAIMessage)));
}

export function buildOpenAIAssistantReplayKey(historyKey: string, assistantMessage: OpenAIChatMessage): string {
	return digest(JSON.stringify({ historyKey, assistant: canonicalOpenAIMessage(assistantMessage) }));
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
		(v.callId === undefined || typeof v.callId === "string") &&
		(v.callIds === undefined ||
			(Array.isArray(v.callIds) &&
				v.callIds.length > 0 &&
				v.callIds.every((callId) => typeof callId === "string" && callId.length > 0))) &&
		(v.assistantMessageKey === undefined || typeof v.assistantMessageKey === "string") &&
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
		(v.conflictingReplayPayload === undefined || v.conflictingReplayPayload === true) &&
		typeof v.capturedAt === "number" &&
		typeof v.byteLength === "number" &&
		v.modelId.length > 0 &&
		((typeof v.callId === "string" && v.callId.length > 0) ||
			(Array.isArray(v.callIds) && v.callIds.length > 0) ||
			(typeof v.assistantMessageKey === "string" && v.assistantMessageKey.length > 0)) &&
		v.byteLength >= 0 &&
		(typeof v.reasoningContent === "string" ||
			Array.isArray(v.reasoningDetails) ||
			typeof v.redactedThinkingData === "string" ||
			v.observedWithoutReplayPayload === true ||
			v.conflictingReplayPayload === true)
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

function replayPayloadIdentity(entry: ThinkingReplayEntry): string {
	return JSON.stringify({
		reasoningContent: entry.reasoningContent,
		reasoningDetails: entry.reasoningDetails,
		reasoningSignature: entry.reasoningSignature,
		redactedThinkingData: entry.redactedThinkingData,
		observedWithoutReplayPayload: entry.observedWithoutReplayPayload === true,
		conflictingReplayPayload: entry.conflictingReplayPayload === true,
	});
}

export class MemoryThinkingReplayStorage implements ThinkingReplayStorage {
	async load(): Promise<readonly ThinkingReplayEntry[]> {
		return [];
	}

	async save(_entries: readonly ThinkingReplayEntry[]): Promise<void> {
		// Intentionally no-op: this backend keeps replay state process-local.
	}

	async append(_entries: readonly ThinkingReplayEntry[]): Promise<void> {
		// Intentionally no-op.
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
		const payload = JSON.stringify({ version: 2, entries }, null, "\t");
		await writeFile(tempPath, payload, "utf8");
		await rename(tempPath, this.filePath);
	}

	async clear(): Promise<void> {
		await rm(this.filePath, { force: true });
	}

	async append(entries: readonly ThinkingReplayEntry[]): Promise<void> {
		// Legacy single-JSON backend: appends degrade to a full read-merge-write.
		const existing = await this.load();
		await this.save([...existing, ...entries]);
	}

	private get filePath(): string {
		if (typeof this.storageFile === "string") {
			return this.storageFile;
		}
		return this.storageFile.fsPath ?? this.storageFile.path ?? "";
	}
}

/**
 * Append-friendly JSONL backend: one entry per line, committed turns are
 * appended in O(turn) instead of rewriting the whole store, and `save()`
 * performs an atomic temp+rename compaction. On load, later lines win for a
 * given key (the in-memory map applies them in order) and a torn trailing
 * line from a crash is ignored. When the JSONL file does not exist yet, a
 * legacy v1 single-JSON file is migrated once and then removed.
 */
export class LocalJsonlThinkingReplayStorage implements ThinkingReplayStorage {
	constructor(
		private readonly storageFile: string | { fsPath?: string; path?: string },
		private readonly options: { readonly legacyJsonFile?: string } = {}
	) {}

	async load(): Promise<readonly ThinkingReplayEntry[]> {
		let raw: string | undefined;
		try {
			raw = await readFile(this.filePath, "utf8");
		} catch {
			raw = undefined;
		}
		if (raw === undefined) {
			return this.migrateLegacyJson();
		}
		const entries: ThinkingReplayEntry[] = [];
		for (const line of raw.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			try {
				const parsed = JSON.parse(trimmed) as unknown;
				if (isReplayEntry(parsed)) {
					entries.push(parsed);
				}
			} catch {
				// Torn or corrupt line (e.g. crash mid-append): skip it.
			}
		}
		return entries;
	}

	async save(entries: readonly ThinkingReplayEntry[]): Promise<void> {
		await mkdir(dirname(this.filePath), { recursive: true });
		const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
		const payload = entries.map((entry) => JSON.stringify(entry)).join("\n");
		await writeFile(tempPath, payload ? `${payload}\n` : "", "utf8");
		await rename(tempPath, this.filePath);
	}

	async append(entries: readonly ThinkingReplayEntry[]): Promise<void> {
		if (entries.length === 0) {
			return;
		}
		await mkdir(dirname(this.filePath), { recursive: true });
		const payload = entries.map((entry) => JSON.stringify(entry)).join("\n");
		await appendFile(this.filePath, `${payload}\n`, "utf8");
	}

	async clear(): Promise<void> {
		await rm(this.filePath, { force: true });
		if (this.options.legacyJsonFile) {
			await rm(this.options.legacyJsonFile, { force: true });
		}
	}

	private async migrateLegacyJson(): Promise<readonly ThinkingReplayEntry[]> {
		const legacyFile = this.options.legacyJsonFile;
		if (!legacyFile) {
			return [];
		}
		let entries: ThinkingReplayEntry[] = [];
		try {
			const parsed = JSON.parse(await readFile(legacyFile, "utf8")) as { entries?: unknown };
			entries = Array.isArray(parsed.entries) ? parsed.entries.filter(isReplayEntry) : [];
		} catch {
			return [];
		}
		if (entries.length > 0) {
			await this.save(entries);
		}
		await rm(legacyFile, { force: true });
		return entries;
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
	private appendedSinceSave = 0;

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
		this.appendedSinceSave = 0;
		const loaded = await storage.load();
		for (const entry of loaded) {
			const normalized = normalizeReplayEntry(entry);
			for (const callId of normalized.callIds ?? []) {
				this.entries.set(callReplayKey(normalized.modelId, callId), normalized);
			}
			if (normalized.callId) {
				this.entries.set(callReplayKey(normalized.modelId, normalized.callId), normalized);
			}
			if (normalized.assistantMessageKey) {
				this.entries.set(assistantReplayKey(normalized.modelId, normalized.assistantMessageKey), normalized);
			}
		}
		await this.prune();
		if (loaded.length > 0) {
			// Startup compaction: collapse appended history (and any legacy
			// duplicates) back into one line per live entry.
			await this.saveSnapshot();
		}
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
						historyKey: undefined,
						captureAssistantMessages: false,
						allowsMissingReplayPayload: false,
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
			assistantContentChunks: [],
			historyKey: config.historyKey,
			captureAssistantMessages: config.captureAssistantMessages ?? false,
			allowsMissingReplayPayload: config.allowsMissingReplayPayload ?? false,
			observedWithoutReplayPayload: false,
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

	appendAssistantContent(turnId: string, text: string): void {
		if (!text) {
			return;
		}
		const pending = this.pending.get(turnId);
		if (!pending || !pending.captureAssistantMessages) {
			return;
		}
		pending.byteLength += byteLength(text);
		if (pending.byteLength > this.maxPendingTurnBytes) {
			pending.invalid = true;
			return;
		}
		pending.assistantContentChunks.push(text);
	}

	markObservedWithoutReplayPayload(turnId: string): void {
		const pending = this.pending.get(turnId);
		if (pending) {
			pending.observedWithoutReplayPayload = true;
		}
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
		if (!pending || pending.invalid) {
			return;
		}

		const reasoningContent = pending.chunks.join("") || undefined;
		const reasoningDetails = pending.detailChunks.length > 0 ? [...pending.detailChunks] : undefined;
		const redactedThinkingData = pending.redactedThinkingChunks.join("") || undefined;
		const hasReplayPayload =
			pending.carrier === "reasoning_details" ? !!reasoningDetails : !!reasoningContent || !!redactedThinkingData;
		const observedWithoutReplayPayload =
			!hasReplayPayload &&
			(pending.carrier === "anthropic_thinking_block" ||
				pending.allowsMissingReplayPayload ||
				pending.observedWithoutReplayPayload)
				? true
				: undefined;
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

		if (pending.callIds.size > 0) {
			// One shared entry per turn: parallel tool calls reference the same
			// payload instead of duplicating it per call id, so the byte budget
			// and the persisted line count the reasoning once.
			const entry: ThinkingReplayEntry = {
				modelId: pending.modelId,
				callIds: [...pending.callIds],
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
			for (const callId of pending.callIds) {
				this.entries.set(callReplayKey(entry.modelId, callId), entry);
			}
			await this.persistCommitted(entry);
			return;
		}

		const assistantContent = pending.assistantContentChunks.join("");
		if (!pending.captureAssistantMessages || !pending.historyKey || !assistantContent) {
			return;
		}
		const assistantMessageKey = buildOpenAIAssistantReplayKey(pending.historyKey, {
			role: "assistant",
			content: assistantContent,
		});
		const storageKey = assistantReplayKey(pending.modelId, assistantMessageKey);
		const entry: ThinkingReplayEntry = {
			modelId: pending.modelId,
			assistantMessageKey,
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
		const existing = this.entries.get(storageKey);
		if (existing && replayPayloadIdentity(existing) !== replayPayloadIdentity(entry)) {
			const conflict: ThinkingReplayEntry = {
				modelId: pending.modelId,
				assistantMessageKey,
				profileId: pending.profileId,
				transport: pending.transport,
				carrier: pending.carrier,
				conflictingReplayPayload: true,
				capturedAt,
				byteLength: 0,
			};
			this.entries.set(storageKey, conflict);
			await this.persistCommitted(conflict);
		} else {
			this.entries.set(storageKey, entry);
			await this.persistCommitted(entry);
		}
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
		const storageKey = callReplayKey(keyModelId, keyCallId);
		const entry = this.entries.get(storageKey);
		if (!entry || !this.isFresh(entry, this.now())) {
			if (entry) {
				this.entries.delete(storageKey);
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

	lookupAssistant(input: AssistantThinkingReplayLookupInput): ThinkingReplayEntry | undefined {
		const storageKey = assistantReplayKey(input.modelId, input.assistantMessageKey);
		const entry = this.entries.get(storageKey);
		if (!entry || !this.isFresh(entry, this.now())) {
			if (entry) {
				this.entries.delete(storageKey);
			}
			return undefined;
		}
		const normalized = normalizeReplayEntry(entry);
		if (normalized.carrier !== input.carrier || normalized.profileId !== input.profileId) {
			return undefined;
		}
		return normalized;
	}

	async prune(now = this.now(), forceSave = false): Promise<void> {
		const before = this.uniqueEntryCount();
		for (const [key, entry] of this.entries) {
			if (!this.isFresh(entry, now)) {
				this.entries.delete(key);
			}
		}

		this.pruneByCount();
		this.pruneByBytes();
		if (forceSave || this.uniqueEntryCount() !== before) {
			await this.saveSnapshot();
		}
	}

	async clear(): Promise<void> {
		this.entries.clear();
		this.pending.clear();
		this.appendedSinceSave = 0;
		await this.storage.clear();
	}

	stats(): ThinkingReplayStats {
		const unique = this.snapshot();
		return {
			entryCount: unique.length,
			totalBytes: unique.reduce((sum, entry) => sum + entry.byteLength, 0),
			pendingCount: this.pending.size,
		};
	}

	/** Append the committed entry and enforce caps; compact when due. */
	private async persistCommitted(entry: ThinkingReplayEntry): Promise<void> {
		await this.storage.append([entry]);
		this.appendedSinceSave++;
		const before = this.uniqueEntryCount();
		this.pruneByCount();
		this.pruneByBytes();
		if (this.uniqueEntryCount() !== before || this.appendedSinceSave >= COMPACTION_APPEND_THRESHOLD) {
			await this.saveSnapshot();
		}
	}

	private async saveSnapshot(): Promise<void> {
		await this.storage.save(this.snapshot());
		this.appendedSinceSave = 0;
	}

	private isFresh(entry: ThinkingReplayEntry, now: number): boolean {
		return entry.capturedAt + this.ttlMs >= now;
	}

	private uniqueEntryCount(): number {
		return new Set(this.entries.values()).size;
	}

	private pruneByCount(): void {
		while (this.uniqueEntryCount() > this.maxEntries) {
			if (!this.evictOldestEntry()) {
				return;
			}
		}
	}

	private pruneByBytes(): void {
		while (this.stats().totalBytes > this.maxTotalBytes) {
			if (!this.evictOldestEntry()) {
				return;
			}
		}
	}

	/** Remove the oldest unique entry along with every key that references it. */
	private evictOldestEntry(): boolean {
		let oldest: ThinkingReplayEntry | undefined;
		for (const entry of this.entries.values()) {
			if (!oldest || entry.capturedAt < oldest.capturedAt) {
				oldest = entry;
			}
		}
		if (!oldest) {
			return false;
		}
		for (const [key, entry] of this.entries) {
			if (entry === oldest) {
				this.entries.delete(key);
			}
		}
		return true;
	}

	private snapshot(): ThinkingReplayEntry[] {
		return [...new Set(this.entries.values())].sort((a, b) => a.capturedAt - b.capturedAt);
	}
}

export const thinkingReplayStore = new ThinkingReplayStore();
