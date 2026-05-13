export const DEFAULT_HIDDEN_MODEL_PATTERNS: readonly string[] = [
	"*vidu*",
	"*seedream*",
	"*seedance*",
	"*image*",
	"*diffusion*",
	"*hailuo*",
	"*kling*",
];

function escapeRegexLiteral(input: string): string {
	return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesPattern(modelId: string, pattern: string): boolean {
	if (!pattern) {
		return false;
	}
	const id = modelId.toLowerCase();
	const pat = pattern.toLowerCase();
	if (pat === id) {
		return true;
	}
	if (!pat.includes("*")) {
		return id.includes(pat);
	}
	const segments = pat.split("*").map(escapeRegexLiteral);
	return new RegExp(`^${segments.join(".*")}$`).test(id);
}

function matchesAnyPattern(modelId: string, patterns: readonly string[]): boolean {
	return patterns.some(pattern => matchesPattern(modelId, pattern));
}

export function isModelHiddenByVisibilityConfig(
	modelId: string,
	hiddenModelIds: ReadonlySet<string>,
	visibleModelIds: ReadonlySet<string>,
	hiddenModelPatterns: readonly string[]
): boolean {
	if (visibleModelIds.has(modelId)) {
		return false;
	}
	return hiddenModelIds.has(modelId) || matchesAnyPattern(modelId, hiddenModelPatterns);
}
