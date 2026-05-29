import * as vscode from "vscode";

import { getActivePlan } from "./utils";
import type { InfiniAIModelInfo, ModelEndpointKind, ModelRoute, ModelRouteConfig, ModelTransport } from "./types";

export type ProtocolSwitchTransport = Extract<ModelTransport, "openai" | "anthropic">;

function escapeRegexLiteral(input: string): string {
	return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchesRoutePattern(modelId: string, pattern: string): boolean {
	if (!pattern) {
		return false;
	}
	if (pattern === modelId || pattern === "*") {
		return true;
	}
	if (!pattern.includes("*")) {
		return false;
	}
	const regex = new RegExp(`^${pattern.split("*").map(escapeRegexLiteral).join(".*")}$`, "i");
	return regex.test(modelId);
}

export function parseModelRouteConfigs(value: unknown): ModelRouteConfig[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const routes: ModelRouteConfig[] = [];
	for (const item of value) {
		if (!item || typeof item !== "object") {
			continue;
		}
		const record = item as Record<string, unknown>;
		const pattern = typeof record.pattern === "string" ? record.pattern.trim() : "";
		const transport = record.transport;
		if (!pattern || (transport !== "openai" && transport !== "anthropic" && transport !== "vertex")) {
			continue;
		}
		const baseUrl = typeof record.baseUrl === "string" && record.baseUrl.trim() ? record.baseUrl.trim() : undefined;
		routes.push({ pattern, transport, baseUrl });
	}
	return routes;
}

function rawPattern(item: unknown): string | undefined {
	if (!item || typeof item !== "object") {
		return undefined;
	}
	const pattern = (item as Record<string, unknown>).pattern;
	return typeof pattern === "string" ? pattern.trim() : undefined;
}

export function getExactModelRouteOverride(value: unknown, modelId: string): ModelRouteConfig | undefined {
	return parseModelRouteConfigs(value).find(route => route.pattern === modelId && !route.pattern.includes("*"));
}

export function countModelRouteOverrides(value: unknown): {
	routeConfigCount: number;
	exactModelRouteOverrideCount: number;
} {
	const routes = parseModelRouteConfigs(value);
	return {
		routeConfigCount: routes.length,
		exactModelRouteOverrideCount: routes.filter(route => route.pattern !== "*" && !route.pattern.includes("*")).length,
	};
}

function isExactModelPattern(item: unknown, modelId: string): boolean {
	return rawPattern(item) === modelId;
}

function insertionIndexForExactOverride(items: readonly unknown[], modelId: string): number {
	let firstExact = -1;
	let firstBroaderMatch = -1;
	for (let i = 0; i < items.length; i++) {
		const pattern = rawPattern(items[i]);
		if (!pattern) {
			continue;
		}
		if (pattern === modelId) {
			if (firstExact < 0) {
				firstExact = i;
			}
			continue;
		}
		if (firstBroaderMatch < 0 && matchesRoutePattern(modelId, pattern)) {
			firstBroaderMatch = i;
		}
	}
	if (firstBroaderMatch >= 0) {
		return firstBroaderMatch;
	}
	return firstExact >= 0 ? firstExact : items.length;
}

export function setExactModelRouteOverride(
	value: unknown,
	modelId: string,
	transport: ProtocolSwitchTransport
): unknown[] {
	const items = Array.isArray(value) ? value : [];
	const existing = getExactModelRouteOverride(value, modelId);
	const next: ModelRouteConfig = { pattern: modelId, transport };
	if (existing?.transport === transport && existing.baseUrl) {
		next.baseUrl = existing.baseUrl;
	}
	const insertAt = insertionIndexForExactOverride(items, modelId);
	const result: unknown[] = [];
	let inserted = false;
	for (let i = 0; i < items.length; i++) {
		if (!inserted && i === insertAt) {
			result.push(next);
			inserted = true;
		}
		if (isExactModelPattern(items[i], modelId)) {
			continue;
		}
		result.push(items[i]);
	}
	if (!inserted) {
		result.push(next);
	}
	return result;
}

export function resetExactModelRouteOverride(value: unknown, modelId: string): unknown[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter(item => !isExactModelPattern(item, modelId));
}

export function endpointKindForTransport(transport: ModelTransport): ModelEndpointKind {
	switch (transport) {
		case "anthropic":
			return "messages";
		case "vertex":
			return "generateContent";
		case "openai":
		default:
			return "chat.completions";
	}
}

function normalizeTransport(value: unknown): ModelTransport | undefined {
	if (value === "openai" || value === "anthropic" || value === "vertex") {
		return value;
	}
	return undefined;
}

function inferTransport(model: InfiniAIModelInfo): ModelTransport {
	const id = model.id.toLowerCase();
	const family = model.family?.toLowerCase() ?? "";
	const endpointKind = model.endpointKind?.toLowerCase() ?? "";
	if (family.includes("messages") || family.includes("anthropic") || id.includes("claude")) {
		return "anthropic";
	}
	if (
		family.includes("generate") ||
		family.includes("vertex") ||
		family.includes("gemini") ||
		endpointKind.includes("generate")
	) {
		return "vertex";
	}
	return "openai";
}

function getCatalogPreferredTransport(model: InfiniAIModelInfo): ModelTransport | undefined {
	const id = model.id.toLowerCase();
	const family = model.family?.toLowerCase() ?? "";
	if (family === "kimi-k2" || id.includes("kimi-k2")) {
		return "openai";
	}
	if (family === "mimo" || family.startsWith("mimo-v2") || id.startsWith("mimo-v2")) {
		return "openai";
	}
	return undefined;
}

function defaultBaseUrl(transport: ModelTransport): string {
	const plan = getActivePlan();
	const config = vscode.workspace.getConfiguration();
	switch (transport) {
		case "anthropic":
			return config.get<string>(
				plan === "coding" ? "infiniai.coding.anthropic.baseUrl" : "infiniai.anthropic.baseUrl",
				plan === "coding" ? "https://cloud.infini-ai.com/maas/coding" : "https://cloud.infini-ai.com/maas"
			);
		case "vertex":
			return config.get<string>(
				plan === "coding" ? "infiniai.coding.baseUrl" : "infiniai.baseUrl",
				plan === "coding" ? "https://cloud.infini-ai.com/maas/coding/v1" : "https://cloud.infini-ai.com/maas/v1"
			);
		case "openai":
		default:
			return config.get<string>(
				plan === "coding" ? "infiniai.coding.baseUrl" : "infiniai.baseUrl",
				plan === "coding" ? "https://cloud.infini-ai.com/maas/coding/v1" : "https://cloud.infini-ai.com/maas/v1"
			);
	}
}

export function resolveModelRoute(model: InfiniAIModelInfo, routeConfigs: ModelRouteConfig[]): ModelRoute {
	for (const routeConfig of routeConfigs) {
		if (matchesRoutePattern(model.id, routeConfig.pattern)) {
			return {
				transport: routeConfig.transport,
				endpointKind: endpointKindForTransport(routeConfig.transport),
				baseUrl: routeConfig.baseUrl ?? model.baseUrl ?? defaultBaseUrl(routeConfig.transport),
				source: "user",
			};
		}
	}

	const catalogPreferredTransport = getCatalogPreferredTransport(model);
	if (catalogPreferredTransport) {
		return {
			transport: catalogPreferredTransport,
			endpointKind: endpointKindForTransport(catalogPreferredTransport),
			baseUrl: defaultBaseUrl(catalogPreferredTransport),
			source: "catalog",
		};
	}

	const metadataTransport = normalizeTransport(model.apiMode);
	if (metadataTransport) {
		return {
			transport: metadataTransport,
			endpointKind: model.endpointKind ?? endpointKindForTransport(metadataTransport),
			baseUrl: model.baseUrl ?? defaultBaseUrl(metadataTransport),
			source: "metadata",
		};
	}

	const transport = inferTransport(model);
	return {
		transport,
		endpointKind: model.endpointKind ?? endpointKindForTransport(transport),
		baseUrl: model.baseUrl ?? defaultBaseUrl(transport),
		source: transport === "openai" ? "heuristic" : "catalog",
	};
}
