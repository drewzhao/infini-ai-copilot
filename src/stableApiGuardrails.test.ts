import assert from "assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import path from "path";

import { BUILT_IN_INFINIAI_MODEL_METADATA } from "./generated/infiniaiCatalogMetadata.generated";

const REPO_ROOT = process.cwd();
const PACKAGE_JSON_PATH = path.join(REPO_ROOT, "package.json");
const RUNTIME_SOURCE_ROOT = path.join(REPO_ROOT, "src");

const HARD_GATED_METADATA_FIELDS = [
	"targetChatSessionType",
	"requiresAuthorization",
	"isDefault",
	"editTools",
] as const;
const PROPOSED_API_MANIFEST_FIELDS = ["enabledApi" + "Proposals", "enable" + "ProposedApi"] as const;

function readPackageJson(): Record<string, any> {
	return JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8"));
}

function walkFiles(root: string): string[] {
	const result: string[] = [];
	for (const entry of readdirSync(root)) {
		const fullPath = path.join(root, entry);
		const stat = statSync(fullPath);
		if (stat.isDirectory()) {
			result.push(...walkFiles(fullPath));
		} else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts") && !entry.endsWith(".d.ts")) {
			result.push(fullPath);
		}
	}
	return result;
}

function findObjectPathsWithKey(value: unknown, key: string, prefix = "$"): string[] {
	if (!value || typeof value !== "object") {
		return [];
	}
	if (Array.isArray(value)) {
		return value.flatMap((item, index) => findObjectPathsWithKey(item, key, `${prefix}[${index}]`));
	}
	const record = value as Record<string, unknown>;
	return [
		...(Object.prototype.hasOwnProperty.call(record, key) ? [`${prefix}.${key}`] : []),
		...Object.entries(record).flatMap(([childKey, child]) => findObjectPathsWithKey(child, key, `${prefix}.${childKey}`)),
	];
}

describe("Stable API guardrails", () => {
	it("declares the InfiniAI authentication provider in the manifest", () => {
		const pkg = readPackageJson();
		assert.deepEqual(pkg.contributes?.authentication, [
			{
				id: "infiniai",
				label: "InfiniAI",
			},
		]);
	});

	it("does not declare proposed API usage in the manifest", () => {
		const pkg = readPackageJson();
		for (const field of PROPOSED_API_MANIFEST_FIELDS) {
			assert.equal(Object.prototype.hasOwnProperty.call(pkg, field), false);
		}
	});

	it("does not ship hard-gated language model metadata fields", () => {
		for (const field of HARD_GATED_METADATA_FIELDS) {
			const paths = findObjectPathsWithKey(BUILT_IN_INFINIAI_MODEL_METADATA, field);
			assert.deepEqual(paths, [], `${field} must not appear in built-in model metadata`);
		}
	});

	it("keeps hard-gated language model metadata out of runtime source", () => {
		const matches: string[] = [];
		for (const file of walkFiles(RUNTIME_SOURCE_ROOT)) {
			if (!existsSync(file)) {
				continue;
			}
			const content = readFileSync(file, "utf8");
			for (const field of HARD_GATED_METADATA_FIELDS) {
				if (content.includes(field)) {
					matches.push(`${path.relative(REPO_ROOT, file)}:${field}`);
				}
			}
		}
		assert.deepEqual(matches, []);
	});
});
