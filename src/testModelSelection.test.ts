import assert from "assert/strict";
import type { LanguageModelChatInformation } from "vscode";

import { getVisibleInfiniAITestModels } from "./testModelSelection";
import type { InfiniAIModelInfo } from "./types";

function model(id: string): InfiniAIModelInfo {
	return {
		id,
		object: "model",
		created: 0,
		owned_by: "infiniai",
	};
}

function info(id: string): LanguageModelChatInformation {
	return {
		id,
		name: id,
		family: id,
		version: "1",
		maxInputTokens: 1000,
		maxOutputTokens: 100,
		capabilities: {
			toolCalling: false,
			imageInput: false,
		},
	};
}

describe("getVisibleInfiniAITestModels", () => {
	it("keeps only visible models from the InfiniAI discovery cache", () => {
		const result = getVisibleInfiniAITestModels(
			[info("infiniai-chat"), info("other-provider-model"), info("hidden-infiniai-chat")],
			[model("infiniai-chat"), model("hidden-infiniai-chat")],
			(modelId) => modelId === "hidden-infiniai-chat"
		);

		assert.deepEqual(
			result.map((item) => item.id),
			["infiniai-chat"]
		);
	});

	it("does not require tool-calling capability for a simple health request", () => {
		const result = getVisibleInfiniAITestModels([info("plain-chat")], [model("plain-chat")], () => false);

		assert.deepEqual(
			result.map((item) => item.id),
			["plain-chat"]
		);
	});
});
