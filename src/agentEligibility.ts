import { matchesModelPattern } from "./modelCapabilities";

export type AgentEligibilityOverride = "automatic" | "enabled" | "disabled";

export interface ToolCallingOverrideLists {
	readonly enable: readonly string[];
	readonly disable: readonly string[];
}

function normalizePatterns(patterns: readonly string[]): string[] {
	const result: string[] = [];
	const seen = new Set<string>();
	for (const pattern of patterns) {
		const normalized = pattern.trim();
		const identity = normalized.toLowerCase();
		if (!normalized || seen.has(identity)) {
			continue;
		}
		seen.add(identity);
		result.push(normalized);
	}
	return result;
}

export function isExactToolCallingPattern(modelId: string, pattern: string): boolean {
	const normalized = pattern.trim();
	return !normalized.includes("*") && normalized.toLowerCase() === modelId.trim().toLowerCase();
}

export function matchingToolCallingPatterns(modelId: string, patterns: readonly string[]): string[] {
	return normalizePatterns(patterns).filter((pattern) => matchesModelPattern(modelId, pattern));
}

export function applyExactToolCallingOverride(
	current: ToolCallingOverrideLists,
	modelId: string,
	override: AgentEligibilityOverride
): ToolCallingOverrideLists {
	const enable = normalizePatterns(current.enable).filter((pattern) => !isExactToolCallingPattern(modelId, pattern));
	const disable = normalizePatterns(current.disable).filter((pattern) => !isExactToolCallingPattern(modelId, pattern));

	if (override === "enabled") {
		enable.push(modelId);
	} else if (override === "disabled") {
		disable.push(modelId);
	}

	return { enable, disable };
}
