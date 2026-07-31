export type ModelLike = {
	id: string;
	toolCallingMetadataSource?: ToolCallingMetadataSource;
	vision?: boolean;
	supports_image_in?: boolean;
	model_type?: string;
	capabilities?: {
		toolCalling?: boolean | number;
		imageInput?: boolean;
	};
	architecture?: {
		input_modalities?: string[];
	};
	input_modalities?: string[];
	modalities?: string[];
};

export type ToolCallingMetadataSource = "api" | "extension";

export type ToolCallingCapabilitySource = "user-disabled" | "user-enabled" | ToolCallingMetadataSource | "unknown";

export interface ToolCallingCapabilityDecision {
	readonly enabled: boolean;
	readonly source: ToolCallingCapabilitySource;
}

export type ImageInputCapabilityConfig = {
	/**
	 * Model ID patterns to force-enable image input.
	 * Supports '*' wildcard (e.g. 'kimi-*').
	 */
	enablePatterns?: string[];
	/**
	 * Model ID patterns to force-disable image input.
	 * Supports '*' wildcard (e.g. 'text-only-*').
	 */
	disablePatterns?: string[];
	/**
	 * Provider-verified fallback patterns used only when metadata is silent.
	 */
	verifiedPatterns?: readonly string[];
};

export type ToolCallingCapabilityConfig = {
	/**
	 * Model ID patterns to force-enable tool calling.
	 * Supports '*' wildcard.
	 */
	enablePatterns?: string[];
	/**
	 * Provider-verified fallback patterns used only when metadata is silent.
	 */
	verifiedPatterns?: readonly string[];
	/**
	 * Model ID patterns to force-disable tool calling.
	 * Supports '*' wildcard. Disable wins over enable.
	 */
	disablePatterns?: string[];
};

export const VERIFIED_TOOL_CALLING_MODEL_PATTERNS = [
	// Exact IDs that passed both a required function call and multi-turn
	// tool-result replay against InfiniAI Chat Completions on 2026-07-31.
	"deepseek-v3",
	"glm-4.5-air",
	"gpt-oss-120b",
	"gpt-5.4",
	"claude-haiku-4-5-20251001",
	"gemini-3.1-flash-lite-preview",
	"minimax-m2.7",
	"minimax-m3",
	// Previously verified exact IDs and narrowly scoped family variants.
	"kimi-k3",
	"deepseek-v4-pro",
	"deepseek-v4-flash",
	"mimo-v2-pro",
	"mimo-v2-omni",
	"mimo-v2.5",
	"mimo-v2.5-pro",
	"mimo-v2.6-pro",
] as const;

// Family-level extension policy: Claude models are advertised for Agent mode
// even when the InfiniAI catalog omits tool-calling metadata. Keep this separate
// from the individually probe-verified list above.
export const DEFAULT_TOOL_CALLING_MODEL_PATTERNS = ["claude-*", ...VERIFIED_TOOL_CALLING_MODEL_PATTERNS] as const;

export const VERIFIED_IMAGE_INPUT_MODEL_PATTERNS = ["kimi-k3"] as const;

function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
}

function escapeRegexLiteral(input: string): string {
	return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchesModelPattern(modelId: string, pattern: string): boolean {
	if (!pattern) {
		return false;
	}
	if (pattern.toLowerCase() === modelId.toLowerCase()) {
		return true;
	}
	if (!pattern.includes("*")) {
		return false;
	}
	// Support a simple glob: '*' matches any substring.
	const segments = pattern.split("*").map(escapeRegexLiteral);
	const regex = new RegExp(`^${segments.join(".*")}$`, "i");
	return regex.test(modelId);
}

function matchesAny(modelId: string, patterns: unknown): boolean {
	const list = toStringArray(patterns);
	for (const p of list) {
		if (matchesModelPattern(modelId, p)) {
			return true;
		}
	}
	return false;
}

function hasImageInModalities(modalities: unknown): boolean {
	const list = toStringArray(modalities).map((m) => m.toLowerCase());
	return list.some((m) => m === "image" || m === "images" || m.includes("image") || m.includes("vision"));
}

export function resolveImageInputCapability(model: ModelLike, config: ImageInputCapabilityConfig = {}): boolean {
	const modelId = model?.id ?? "";

	// 1) User overrides (disable wins over enable)
	if (matchesAny(modelId, config.disablePatterns)) {
		return false;
	}
	if (matchesAny(modelId, config.enablePatterns)) {
		return true;
	}

	// 2) Prefer explicit metadata, with a negative winning if sources conflict.
	const explicitCapabilities = [model.vision, model.supports_image_in, model.capabilities?.imageInput].filter(
		(value): value is boolean => typeof value === "boolean"
	);
	if (explicitCapabilities.includes(false)) {
		return false;
	}
	if (explicitCapabilities.includes(true)) {
		return true;
	}
	if (hasImageInModalities(model.architecture?.input_modalities)) {
		return true;
	}
	if (hasImageInModalities(model.input_modalities)) {
		return true;
	}
	if (hasImageInModalities(model.modalities)) {
		return true;
	}

	// 3) InfiniAI's chat catalog uses this type for models that accept multimodal input.
	if (model.model_type?.trim() === "多模态模型") {
		return true;
	}

	// 4) Exact provider-verified fallbacks apply only when stronger metadata is silent.
	if (matchesAny(modelId, config.verifiedPatterns)) {
		return true;
	}

	// 5) Fallback heuristics (best-effort)
	return modelId.includes("-vision") || modelId.includes("-vl-") || (modelId.startsWith("glm") && /\dv$/.test(modelId));
}

export function resolveToolCallingCapabilityDecision(
	model: ModelLike,
	config: ToolCallingCapabilityConfig = {}
): ToolCallingCapabilityDecision {
	const modelId = model?.id ?? "";

	// User overrides are intentional; disable wins if both lists match.
	if (matchesAny(modelId, config.disablePatterns)) {
		return { enabled: false, source: "user-disabled" };
	}
	if (matchesAny(modelId, config.enablePatterns)) {
		return { enabled: true, source: "user-enabled" };
	}

	const explicit = model.capabilities?.toolCalling;
	if (typeof explicit === "boolean") {
		return { enabled: explicit, source: model.toolCallingMetadataSource ?? "api" };
	}
	if (typeof explicit === "number" && Number.isFinite(explicit)) {
		return { enabled: explicit > 0, source: model.toolCallingMetadataSource ?? "api" };
	}
	if (matchesAny(modelId, config.verifiedPatterns)) {
		return { enabled: true, source: "extension" };
	}

	// Unknown capability is not Agent-eligible until metadata or a user override confirms it.
	return { enabled: false, source: "unknown" };
}

export function resolveToolCallingCapability(model: ModelLike, config: ToolCallingCapabilityConfig = {}): boolean {
	return resolveToolCallingCapabilityDecision(model, config).enabled;
}
