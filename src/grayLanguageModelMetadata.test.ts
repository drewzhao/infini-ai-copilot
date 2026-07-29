import assert from "assert/strict";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import type * as vscode from "vscode";

import {
	makeUserSelectableLanguageModelInfo,
	withStableSafeGrayLanguageModelMetadata,
} from "./grayLanguageModelMetadata";

const REPO_ROOT = process.cwd();
const RUNTIME_SOURCE_ROOT = path.join(REPO_ROOT, "src");
const HELPER_PATH = path.join("src", "grayLanguageModelMetadata.ts");
const STABLE_SAFE_GRAY_FIELDS = ["isBYOK", "isUserSelectable", "statusIcon", "configurationSchema"] as const;

function baseLanguageModelInfo(): vscode.LanguageModelChatInformation {
	return {
		id: "qwen3-32b",
		name: "qwen3-32b",
		family: "qwen3",
		version: "1.0.0",
		maxInputTokens: 122880,
		maxOutputTokens: 8192,
		capabilities: {
			toolCalling: true,
			imageInput: false,
		},
	};
}

function walkRuntimeSourceFiles(root: string): string[] {
	const result: string[] = [];
	for (const entry of readdirSync(root)) {
		const fullPath = path.join(root, entry);
		const stat = statSync(fullPath);
		if (stat.isDirectory()) {
			result.push(...walkRuntimeSourceFiles(fullPath));
		} else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts") && !entry.endsWith(".d.ts")) {
			result.push(fullPath);
		}
	}
	return result;
}

describe("gray language model metadata", () => {
	it("adds Stable-safe gray metadata without changing stable model information", () => {
		const base = baseLanguageModelInfo();
		const result = withStableSafeGrayLanguageModelMetadata(base, { isUserSelectable: true });

		assert.notEqual(result, base);
		assert.equal(result.id, base.id);
		assert.equal(result.family, base.family);
		assert.equal(result.isUserSelectable, true);
		assert.equal("isBYOK" in result, false);
		assert.equal("statusIcon" in result, false);
	});

	it("adds BYOK metadata only when explicitly provided", () => {
		const result = withStableSafeGrayLanguageModelMetadata(baseLanguageModelInfo(), { isBYOK: true });

		assert.equal(result.isBYOK, true);
		assert.equal("isUserSelectable" in result, false);
	});

	it("adds status icons only when explicitly provided", () => {
		const statusIcon = { id: "check" } as vscode.ThemeIcon;
		const result = withStableSafeGrayLanguageModelMetadata(baseLanguageModelInfo(), { statusIcon });

		assert.equal(result.statusIcon, statusIcon);
		assert.equal("isUserSelectable" in result, false);
	});

	it("exports only confirmed tool-capable models to the 1.130 Agents bridge", () => {
		const toolCapable = makeUserSelectableLanguageModelInfo(baseLanguageModelInfo());
		const textOnly = makeUserSelectableLanguageModelInfo({
			...baseLanguageModelInfo(),
			capabilities: { toolCalling: false, imageInput: false },
		});

		assert.equal(toolCapable.isBYOK, true);
		assert.equal(textOnly.isBYOK, false);
		assert.equal(toolCapable.isUserSelectable, true);
		assert.equal(textOnly.isUserSelectable, true);
	});

	it("adds model configuration schemas only when explicitly provided", () => {
		const schema = {
			properties: {
				maxOutputTokens: {
					type: "number" as const,
					title: "Max output tokens",
					enum: [0, 1024],
					default: 0,
				},
			},
		};
		const result = withStableSafeGrayLanguageModelMetadata(baseLanguageModelInfo(), {
			configurationSchema: schema,
		});

		assert.equal(result.configurationSchema, schema);
		assert.equal("isUserSelectable" in result, false);
	});

	it("keeps Stable-safe gray metadata writes centralized", () => {
		const matches: string[] = [];
		for (const file of walkRuntimeSourceFiles(RUNTIME_SOURCE_ROOT)) {
			const relativePath = path.relative(REPO_ROOT, file);
			const content = readFileSync(file, "utf8");
			for (const field of STABLE_SAFE_GRAY_FIELDS) {
				if (content.includes(field)) {
					matches.push(`${relativePath}:${field}`);
				}
			}
		}

		assert.ok(matches.some((match) => match === `${HELPER_PATH}:isUserSelectable`));
		assert.ok(matches.some((match) => match === `${HELPER_PATH}:isBYOK`));
		assert.ok(matches.some((match) => match === `${HELPER_PATH}:configurationSchema`));
		assert.deepEqual(
			matches.filter((match) => !match.startsWith(`${HELPER_PATH}:`)),
			[]
		);
	});
});
