export type ModelLike = {
	id: string;
	vision?: boolean;
	capabilities?: {
		toolCalling?: boolean | number;
	};
	architecture?: {
		input_modalities?: string[];
	};
	input_modalities?: string[];
	modalities?: string[];
};

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
	"kimi-k3",
	"deepseek-v4-pro",
	"deepseek-v4-flash",
	"mimo-v2-pro",
	"mimo-v2-omni",
	"mimo-v2.5",
	"mimo-v2.5-pro",
	"mimo-v2.6-pro",
] as const;

function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
}

function escapeRegexLiteral(input: string): string {
	return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesPattern(modelId: string, pattern: string): boolean {
	if (!pattern) {
		return false;
	}
	if (pattern === modelId) {
		return true;
	}
	if (!pattern.includes("*")) {
		return false;
	}
	// Support a simple glob: '*' matches any substring.
	const segments = pattern.split("*").map(escapeRegexLiteral);
	const regex = new RegExp(`^${segments.join(".*")}$`);
	return regex.test(modelId);
}

function matchesAny(modelId: string, patterns: unknown): boolean {
	const list = toStringArray(patterns);
	for (const p of list) {
		if (matchesPattern(modelId, p)) {
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

	// 2) Prefer explicit metadata, when present
	if (model.vision === true) {
		return true;
	}
	if (model.vision === false) {
		return false;
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

	// 3) Fallback heuristics (best-effort)
	return modelId.includes("-vision") || modelId.includes("-vl-") || (modelId.startsWith("glm") && /\dv$/.test(modelId));
}

export function resolveToolCallingCapability(model: ModelLike, config: ToolCallingCapabilityConfig = {}): boolean {
	const modelId = model?.id ?? "";

	// User overrides are intentional; disable wins if both lists match.
	if (matchesAny(modelId, config.disablePatterns)) {
		return false;
	}
	if (matchesAny(modelId, config.enablePatterns)) {
		return true;
	}

	const explicit = model.capabilities?.toolCalling;
	if (typeof explicit === "boolean") {
		return explicit;
	}
	if (typeof explicit === "number" && Number.isFinite(explicit)) {
		return explicit > 0;
	}
	if (matchesAny(modelId, config.verifiedPatterns)) {
		return true;
	}

	// Unknown capability is not Agent-eligible until metadata or a user override confirms it.
	return false;
}
