import assert from "assert/strict";

type Plan = "standard" | "coding";

const Module = require("module") as any;
const originalLoad = Module._load;
Module._load = (request: string, parent: unknown, isMain: boolean) => {
	if (request === "vscode") {
		return {};
	}
	return originalLoad(request, parent, isMain);
};

const utils = require("./utils") as {
	resolvePlanForApiKey?: (options: {
		configuredPlan: Plan | undefined;
		promptPlan: () => Promise<Plan | undefined>;
		updatePlan: (plan: Plan) => Promise<void>;
	}) => Promise<Plan | undefined>;
};

describe("resolvePlanForApiKey", () => {
	it("returns configured plan without prompting", async () => {
		const resolvePlanForApiKey = utils.resolvePlanForApiKey;
		if (typeof resolvePlanForApiKey !== "function") {
			assert.fail("resolvePlanForApiKey not exported");
			return;
		}

		let promptCalls = 0;
		let updateCalls = 0;
		const result = await resolvePlanForApiKey({
			configuredPlan: "coding",
			promptPlan: async () => {
				promptCalls += 1;
				return "standard";
			},
			updatePlan: async () => {
				updateCalls += 1;
			},
		});

		assert.equal(result, "coding");
		assert.equal(promptCalls, 0);
		assert.equal(updateCalls, 0);
	});

	it("prompts and persists selection when plan missing", async () => {
		const resolvePlanForApiKey = utils.resolvePlanForApiKey;
		if (typeof resolvePlanForApiKey !== "function") {
			assert.fail("resolvePlanForApiKey not exported");
			return;
		}

		let promptCalls = 0;
		let updateCalls = 0;
		const result = await resolvePlanForApiKey({
			configuredPlan: undefined,
			promptPlan: async () => {
				promptCalls += 1;
				return "standard";
			},
			updatePlan: async () => {
				updateCalls += 1;
			},
		});

		assert.equal(result, "standard");
		assert.equal(promptCalls, 1);
		assert.equal(updateCalls, 1);
	});

	it("returns undefined when prompt is canceled", async () => {
		const resolvePlanForApiKey = utils.resolvePlanForApiKey;
		if (typeof resolvePlanForApiKey !== "function") {
			assert.fail("resolvePlanForApiKey not exported");
			return;
		}

		let updateCalls = 0;
		const result = await resolvePlanForApiKey({
			configuredPlan: undefined,
			promptPlan: async () => undefined,
			updatePlan: async () => {
				updateCalls += 1;
			},
		});

		assert.equal(result, undefined);
		assert.equal(updateCalls, 0);
	});
});
