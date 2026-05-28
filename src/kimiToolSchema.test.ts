import assert from "assert/strict";

import { sanitizeKimiOpenAITools, sanitizeKimiToolSchema } from "./kimiToolSchema";

describe("sanitizeKimiToolSchema", () => {
	it("normalizes common VS Code tool-schema shapes that Moonshot rejects", () => {
		const sanitized = sanitizeKimiToolSchema({
			type: "object",
			properties: {
				query: {
					description: "Search query",
					enum: ["", "code", null],
				},
				limit: {
					type: "number",
					anyOf: [{ type: "integer" }, { type: "null" }],
				},
				item: {
					$ref: "#/$defs/item",
					description: "sibling should be removed",
				},
				coords: {
					type: "array",
					items: [{ type: "number" }, { type: "number" }],
				},
			},
			$defs: {
				item: {
					type: "object",
					properties: {
						name: {},
					},
				},
			},
		});

		assert.deepEqual(sanitized, {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "Search query",
					enum: ["code"],
				},
				limit: {
					anyOf: [{ type: "integer" }],
				},
				item: {
					$ref: "#/$defs/item",
				},
				coords: {
					type: "array",
					items: { type: "number" },
				},
			},
			$defs: {
				item: {
					type: "object",
					properties: {
						name: {
							type: "string",
						},
					},
				},
			},
		});
	});

	it("keeps empty tool parameter schemas as object parameters", () => {
		const [tool] = sanitizeKimiOpenAITools([
			{
				type: "function",
				function: {
					name: "noop",
					description: "",
					parameters: {},
				},
			},
		]);

		assert.deepEqual(tool.function.parameters, {
			type: "object",
			properties: {},
		});
	});
});
