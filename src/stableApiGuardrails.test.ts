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
		...Object.entries(record).flatMap(([childKey, child]) =>
			findObjectPathsWithKey(child, key, `${prefix}.${childKey}`)
		),
	];
}

describe("Stable API guardrails", () => {
	it("uses only VS Code provider-group authentication", () => {
		const pkg = readPackageJson();
		assert.equal(pkg.contributes?.authentication, undefined);
		assert.equal(
			pkg.contributes?.commands?.some((command: Record<string, unknown>) =>
				["infiniai.setApikey", "infiniai.signOut"].includes(String(command.command))
			),
			false
		);
	});

	it("declares the unified endpoint defaults", () => {
		const pkg = readPackageJson();
		const properties = pkg.contributes?.configuration?.properties ?? {};
		assert.equal(properties["infiniai.baseUrl"]?.default, "https://cloud.infini-ai.com/maas/v1");
		assert.equal(properties["infiniai.anthropic.baseUrl"]?.default, "https://cloud.infini-ai.com/maas");
		assert.equal(properties["infiniai.modelDiscoveryUrl"]?.default, "");
		assert.equal(properties["infiniai.modelDiscoveryTimeoutMs"]?.default, 15000);
		assert.deepEqual(properties["infiniai.toolCallingModels"]?.default, []);
		assert.deepEqual(properties["infiniai.disableToolCallingModels"]?.default, []);
	});

	it("uses VS Code provider configuration instead of the deprecated management command", () => {
		const pkg = readPackageJson();
		const provider = pkg.contributes?.languageModelChatProviders?.find(
			(candidate: Record<string, unknown>) => candidate.vendor === "infiniai"
		);
		assert.ok(provider);
		assert.equal(Object.prototype.hasOwnProperty.call(provider, "managementCommand"), false);
		assert.deepEqual(provider.configuration, {
			type: "object",
			properties: {
				apiKey: {
					type: "string",
					secret: true,
					title: "%provider.configuration.apiKey.title%",
					description: "%provider.configuration.apiKey.description%",
				},
			},
			required: ["apiKey"],
		});
	});

	it("contributes guided provider-group onboarding without replacing VS Code credential management", () => {
		const pkg = readPackageJson();
		const commandIds = pkg.contributes?.commands?.map((command: Record<string, unknown>) => command.command) ?? [];
		assert.ok(commandIds.includes("infiniai.addProviderGroup"));

		const walkthrough = pkg.contributes?.walkthroughs?.find(
			(candidate: Record<string, unknown>) => candidate.id === "infiniai.gettingStarted"
		);
		assert.ok(walkthrough);
		const steps = walkthrough.steps as Array<Record<string, unknown>>;
		const providerGroupStep = steps.find((step) => step.id === "infiniai.gettingStarted.addProviderGroup") as Record<
			string,
			unknown
		>;
		assert.ok(providerGroupStep);
		assert.deepEqual(providerGroupStep.completionEvents, ["onCommand:infiniai.addProviderGroup"]);
		assert.equal((providerGroupStep.media as Record<string, unknown>).markdown, "walkthroughs/provider-group.md");
	});

	it("pins the intended Stable host floor and development typings", () => {
		const pkg = readPackageJson();
		assert.equal(pkg.engines?.vscode, "^1.130.0");
		assert.equal(pkg.devDependencies?.["@types/vscode"], "1.125.0");
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
