export type ModelLike = {
	id: string;
	vision?: boolean;
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
	return (
		modelId.includes("-vision") ||
		modelId.includes("-vl-") ||
		(modelId.startsWith("glm") && /\dv$/.test(modelId))
	);
}

