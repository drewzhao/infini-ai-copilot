#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const SRC_DIR = path.join(REPO_ROOT, "src");
const PACKAGE_JSON = path.join(REPO_ROOT, "package.json");
const GRAY_HELPER = path.join("src", "grayLanguageModelMetadata.ts");
const DEFAULT_VSCODE_APP = "/Applications/Visual Studio Code.app";
const DEFAULT_VSCODE_SOURCE = path.resolve(REPO_ROOT, "../vscode");
const AGENT_HOST_BYOK_BRIDGE_FILES = [
	"src/vs/platform/agentHost/common/agentHostByokLm.ts",
	"src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostByokLmHandler.ts",
];

const HARD_GATED_PATTERNS = [
	"targetChatSessionType",
	"requiresAuthorization",
	"isDefault",
	"editTools",
];

const STABLE_SAFE_GRAY_FIELDS = ["isBYOK", "isUserSelectable", "statusIcon", "configurationSchema"];

const REQUIRED_BUNDLE_STRINGS = [
	"isUserSelectable",
	"isBYOK",
	"statusIcon",
	"configurationSchema",
	"modelConfiguration",
	"editTools",
	"targetChatSessionType",
];

const REQUIRED_SOURCE_PATTERNS = [
	{
		file: "src/vs/workbench/api/common/extHostLanguageModels.ts",
		strings: [
			"provideLanguageModelChatInformation({ silent: options.silent, configuration: options.configuration }",
			"isBYOK: m.isBYOK",
			"isUserSelectable: m.isUserSelectable",
			"statusIcon: m.statusIcon",
			"configurationSchema: m.configurationSchema",
			"modelConfiguration: options.configuration",
			"knownModel.info",
			"m.capabilities.editTools",
			"checkProposedApiEnabled(data.extension, 'chatProvider')",
			"m.requiresAuthorization && isProposedApiEnabled(data.extension, 'chatProvider')",
			"m.isDefault === true",
			"targetChatSessionType: m.targetChatSessionType",
		],
	},
	{
		file: "src/vs/workbench/contrib/chat/common/languageModels.ts",
		strings: [
			"getModelConfiguration(modelId: string)",
			"getModelConfigurationActions(modelId: string)",
			"setModelConfiguration(modelId: string",
			"configurationSchema?: ILanguageModelConfigurationSchema",
			"const configuration = this.getModelConfiguration(modelId)",
			"configuration: { ...configuration, ...options.configuration }",
		],
	},
	{
		file: "src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostByokLmHandler.ts",
		strings: [
			"metadata?.isBYOK && !metadata.targetChatSessionType",
			"modelIdentifier: identifier",
			"sendChatRequest(modelIdentifier",
		],
	},
	{
		file: "src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostLanguageModelProvider.ts",
		strings: ["toolCalling: true", "agentMode: true"],
	},
	{
		file: "src/vs/platform/agentHost/node/copilot/copilotSessionLauncher.ts",
		strings: ["const selectionId = `${m.vendor}/${m.id}`;"],
	},
];

const results = [];

function pass(name, detail) {
	results.push({ status: "PASS", name, detail });
}

function fail(name, detail) {
	results.push({ status: "FAIL", name, detail });
}

function warn(name, detail) {
	results.push({ status: "WARN", name, detail });
}

function readText(file) {
	return fs.readFileSync(file, "utf8");
}

function pathExists(file) {
	try {
		fs.accessSync(file);
		return true;
	} catch {
		return false;
	}
}

function walkFiles(root, predicate) {
	const found = [];
	for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
		const fullPath = path.join(root, entry.name);
		if (entry.isDirectory()) {
			found.push(...walkFiles(fullPath, predicate));
		} else if (predicate(fullPath, entry.name)) {
			found.push(fullPath);
		}
	}
	return found;
}

function relativeRepoPath(file) {
	return path.relative(REPO_ROOT, file).split(path.sep).join("/");
}

function sourceFiles() {
	return walkFiles(
		SRC_DIR,
		(file, name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")
	);
}

function jsBundleFiles(outDir) {
	return walkFiles(outDir, (_file, name) => name.endsWith(".js") && !name.startsWith("nls"));
}

function checkManifestPolicy() {
	const raw = readText(PACKAGE_JSON);
	const manifest = JSON.parse(raw);
	if (Object.hasOwn(manifest, "enabledApiProposals")) {
		fail("Manifest does not declare enabledApiProposals", "package.json has enabledApiProposals");
	} else {
		pass("Manifest does not declare enabledApiProposals");
	}

	if (raw.includes("enableProposedApi")) {
		fail("Manifest/source policy does not mention enableProposedApi", "package.json contains enableProposedApi");
	} else {
		pass("Manifest has no enableProposedApi string");
	}
}

function checkRuntimeSourcePolicy() {
	const violations = [];
	for (const file of sourceFiles()) {
		const relative = relativeRepoPath(file);
		const content = readText(file);
		for (const pattern of HARD_GATED_PATTERNS) {
			if (content.includes(pattern)) {
				violations.push(`${relative}:${pattern}`);
			}
		}
	}
	if (violations.length) {
		fail("Runtime source avoids proposal-gated fields", violations.join(", "));
	} else {
		pass("Runtime source avoids proposal-gated fields");
	}
}

function checkGrayFieldCentralization() {
	const violations = [];
	for (const file of sourceFiles()) {
		const relative = relativeRepoPath(file);
		const content = readText(file);
		for (const field of STABLE_SAFE_GRAY_FIELDS) {
			if (content.includes(field) && relative !== GRAY_HELPER) {
				violations.push(`${relative}:${field}`);
			}
		}
	}
	if (violations.length) {
		fail("Stable-safe gray metadata fields are centralized", violations.join(", "));
	} else {
		pass("Stable-safe gray metadata fields are centralized", GRAY_HELPER);
	}
}

function checkInstalledStableBundle() {
	const appPath = process.env.VSCODE_APP_PATH || DEFAULT_VSCODE_APP;
	const appPackage = path.join(appPath, "Contents", "Resources", "app", "package.json");
	const outDir = path.join(appPath, "Contents", "Resources", "app", "out");
	if (!pathExists(appPackage) || !pathExists(outDir)) {
		fail("VS Code Stable bundle is available", `Set VSCODE_APP_PATH; checked ${appPath}`);
		return;
	}

	const version = JSON.parse(readText(appPackage)).version ?? "unknown";
	pass("VS Code Stable bundle is available", `${appPath} (${version})`);

	const bundleFiles = jsBundleFiles(outDir);
	const found = new Map(REQUIRED_BUNDLE_STRINGS.map((needle) => [needle, []]));
	for (const file of bundleFiles) {
		const content = readText(file);
		for (const needle of REQUIRED_BUNDLE_STRINGS) {
			if (content.includes(needle)) {
				found.get(needle)?.push(path.relative(outDir, file).split(path.sep).join("/"));
			}
		}
	}

	for (const needle of REQUIRED_BUNDLE_STRINGS) {
		const files = found.get(needle) ?? [];
		if (files.length) {
			pass(`Stable bundle contains ${needle}`, [...new Set(files)].join(", "));
		} else {
			fail(`Stable bundle contains ${needle}`, "not found");
		}
	}
}

function checkOptionalVSCodeSource() {
	const sourceDir = process.env.VSCODE_SOURCE_DIR || DEFAULT_VSCODE_SOURCE;
	if (!pathExists(sourceDir)) {
		warn("VS Code source pattern checks skipped", `Set VSCODE_SOURCE_DIR; checked ${sourceDir}`);
		return;
	}

	for (const entry of REQUIRED_SOURCE_PATTERNS) {
		const file = path.join(sourceDir, entry.file);
		if (!pathExists(file)) {
			fail(`VS Code source file exists: ${entry.file}`, "not found");
			continue;
		}
		const content = readText(file);
		for (const needle of entry.strings) {
			if (content.includes(needle)) {
				pass(`VS Code source contains ${needle}`, entry.file);
			} else {
				fail(`VS Code source contains ${needle}`, entry.file);
			}
		}
	}

	const bridgeFiles = AGENT_HOST_BYOK_BRIDGE_FILES.map((relative) => ({
		relative,
		file: path.join(sourceDir, relative),
	}));
	if (bridgeFiles.some(({ file }) => !pathExists(file))) {
		for (const { relative, file } of bridgeFiles) {
			if (!pathExists(file)) {
				fail(`VS Code agent-host BYOK bridge file exists: ${relative}`, "not found");
			}
		}
		return;
	}
	const bridgeCarriesModelConfigurationSchema = bridgeFiles.some(({ file }) => {
		const content = readText(file);
		return content.includes("configurationSchema") || content.includes("configSchema");
	});
	if (bridgeCarriesModelConfigurationSchema) {
		warn(
			"Agents-window model-control limitation needs revalidation",
			"agent-host BYOK bridge now mentions a model configuration schema"
		);
	} else {
		pass(
			"Agents-window model-control limitation is still present",
			"BYOK bridge omits the model configuration schema; saved request configuration is merged separately"
		);
	}
}

function printClassification() {
	console.log("");
	console.log("Candidate classification:");
	console.log("- safe gray surface: isBYOK, isUserSelectable, statusIcon, configurationSchema, modelConfiguration");
	console.log("- proposal-gated: capabilities.editTools, requiresAuthorization, isDefault");
	console.log("- trap / avoid: targetChatSessionType for Agents-window compatibility");
	console.log("- Agents window: BYOK requests work, but its bridge currently omits per-model control schemas");
	console.log("- Agents window: duplicate model ids across provider groups share one vendor/model selection id");
	console.log("- copied but inert unless wired to request mapping: unknown model configuration keys");
}

function printResults() {
	for (const result of results) {
		const suffix = result.detail ? ` - ${result.detail}` : "";
		console.log(`${result.status} ${result.name}${suffix}`);
	}
	printClassification();
}

checkManifestPolicy();
checkRuntimeSourcePolicy();
checkGrayFieldCentralization();
checkInstalledStableBundle();
checkOptionalVSCodeSource();
printResults();

if (results.some((result) => result.status === "FAIL")) {
	process.exitCode = 1;
}
