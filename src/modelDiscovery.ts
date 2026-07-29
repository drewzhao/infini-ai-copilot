import type { InfiniAIModelInfo } from "./types";

export const INFINIAI_CHAT_MODEL_TYPES = ["大语言模型", "多模态模型"] as const;
export const INFINIAI_NON_CHAT_MODEL_TYPES = ["生图大模型", "视频大模型", "向量模型", "重排序模型"] as const;

export type InfiniAIModelTypeClassification = "chat" | "non-chat" | "unknown";

export interface NormalizedInfiniAIModelsResponse {
	readonly models: InfiniAIModelInfo[];
	readonly rawModelCount: number;
	readonly malformedModelCount: number;
	readonly duplicateModelCount: number;
}

export interface InfiniAIChatModelSelection {
	readonly models: InfiniAIModelInfo[];
	readonly nonChatModelCount: number;
	readonly unknownModelTypeCount: number;
	readonly liveOutputLimitCount: number;
}

export type InfiniAIModelsResponseNormalization =
	| { readonly ok: true; readonly value: NormalizedInfiniAIModelsResponse }
	| { readonly ok: false; readonly error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const normalized = value.trim();
	return normalized || undefined;
}

function positiveInteger(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return undefined;
	}
	return Math.floor(value);
}

function nonNegativeInteger(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		return 0;
	}
	return Math.floor(value);
}

function listEnvelope(value: unknown): Record<string, unknown> | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	if (value.object === "list" && Array.isArray(value.data)) {
		return value;
	}
	if (isRecord(value.data) && value.data.object === "list" && Array.isArray(value.data.data)) {
		return value.data;
	}
	return undefined;
}

function normalizeModel(value: unknown): InfiniAIModelInfo | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const id = nonEmptyString(value.id);
	if (!id || value.object !== "model") {
		return undefined;
	}

	const maxOutputLength =
		positiveInteger(value.max_output_length) ??
		positiveInteger(value.max_tokens) ??
		positiveInteger(value.maxOutputTokens);

	return {
		...(value as Partial<InfiniAIModelInfo>),
		id,
		object: "model",
		created: nonNegativeInteger(value.created),
		owned_by: typeof value.owned_by === "string" ? value.owned_by.trim() : "",
		model_type: nonEmptyString(value.model_type),
		context_length: positiveInteger(value.context_length),
		max_output_length: maxOutputLength,
		max_tokens: maxOutputLength,
		maxOutputTokens: maxOutputLength,
	};
}

export function normalizeInfiniAIModelsResponse(value: unknown): InfiniAIModelsResponseNormalization {
	const envelope = listEnvelope(value);
	if (!envelope) {
		return {
			ok: false,
			error: 'Unexpected models response structure: expected object "list" with a data array',
		};
	}

	const rows = envelope.data as unknown[];
	const models: InfiniAIModelInfo[] = [];
	const seenIds = new Set<string>();
	let malformedModelCount = 0;
	let duplicateModelCount = 0;

	for (const row of rows) {
		const model = normalizeModel(row);
		if (!model) {
			malformedModelCount++;
			continue;
		}
		if (seenIds.has(model.id)) {
			duplicateModelCount++;
			continue;
		}
		seenIds.add(model.id);
		models.push(model);
	}

	return {
		ok: true,
		value: {
			models,
			rawModelCount: rows.length,
			malformedModelCount,
			duplicateModelCount,
		},
	};
}

export function classifyInfiniAIModelType(modelType: string | undefined): InfiniAIModelTypeClassification {
	if ((INFINIAI_CHAT_MODEL_TYPES as readonly string[]).includes(modelType ?? "")) {
		return "chat";
	}
	if ((INFINIAI_NON_CHAT_MODEL_TYPES as readonly string[]).includes(modelType ?? "")) {
		return "non-chat";
	}
	return "unknown";
}

export function selectInfiniAIChatModels(models: readonly InfiniAIModelInfo[]): InfiniAIChatModelSelection {
	const selected: InfiniAIModelInfo[] = [];
	let nonChatModelCount = 0;
	let unknownModelTypeCount = 0;
	let liveOutputLimitCount = 0;

	for (const model of models) {
		switch (classifyInfiniAIModelType(model.model_type)) {
			case "chat":
				selected.push(model);
				if (positiveInteger(model.max_output_length) !== undefined) {
					liveOutputLimitCount++;
				}
				break;
			case "non-chat":
				nonChatModelCount++;
				break;
			case "unknown":
				unknownModelTypeCount++;
				break;
		}
	}

	return {
		models: selected,
		nonChatModelCount,
		unknownModelTypeCount,
		liveOutputLimitCount,
	};
}

export function formatInfiniAIModelType(modelType: string | undefined): string | undefined {
	switch (modelType) {
		case "大语言模型":
			return "Large language model";
		case "多模态模型":
			return "Multimodal model";
		case "生图大模型":
			return "Image generation model";
		case "视频大模型":
			return "Video generation model";
		case "向量模型":
			return "Embedding model";
		case "重排序模型":
			return "Reranker model";
		default:
			return modelType?.trim() || undefined;
	}
}

export function resolveInfiniAIModelVersion(model: Pick<InfiniAIModelInfo, "created" | "version">): string {
	if (model.version?.trim()) {
		return model.version.trim();
	}
	const created = positiveInteger(model.created);
	return created === undefined ? "1.0.0" : created.toString();
}
