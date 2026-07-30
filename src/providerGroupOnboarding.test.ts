import assert from "assert/strict";

const Module = require("module") as any;

function loadProviderGroupOnboarding(informationResult?: string) {
	const originalLoad = Module._load;
	const informationCalls: unknown[][] = [];
	const commandCalls: unknown[][] = [];
	const vscodeMock = {
		l10n: {
			t: (message: string, ...args: unknown[]) =>
				args.length === 0 ? message : message.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)])),
		},
		window: {
			showInformationMessage: async (...args: unknown[]) => {
				informationCalls.push(args);
				return informationResult;
			},
		},
		commands: {
			executeCommand: async (...args: unknown[]) => {
				commandCalls.push(args);
			},
		},
	};

	delete require.cache[require.resolve("./providerGroupOnboarding")];
	Module._load = (request: string, parent: unknown, isMain: boolean) => {
		if (request === "vscode") {
			return vscodeMock;
		}
		return originalLoad(request, parent, isMain);
	};

	try {
		return {
			module: require("./providerGroupOnboarding") as typeof import("./providerGroupOnboarding"),
			informationCalls,
			commandCalls,
		};
	} finally {
		Module._load = originalLoad;
	}
}

describe("provider group onboarding", () => {
	it("explains Group Name before opening VS Code Language Models", async () => {
		const loaded = loadProviderGroupOnboarding("Open Language Models");

		await loaded.module.showAddProviderGroupGuide();

		assert.equal(loaded.informationCalls.length, 1);
		assert.equal(loaded.informationCalls[0][0], "Add an InfiniAI provider group");
		assert.deepEqual((loaded.informationCalls[0][1] as { modal: boolean }).modal, true);
		assert.match(
			String((loaded.informationCalls[0][1] as { detail: string }).detail),
			/Group Name is a local VS Code label/
		);
		assert.match(String((loaded.informationCalls[0][1] as { detail: string }).detail), /Do not paste the API key/);
		assert.equal(loaded.informationCalls[0][2], "Open Language Models");
		assert.deepEqual(loaded.commandCalls, [["infiniai.openManageModels"]]);
	});

	it("does not open Language Models when the guide is cancelled", async () => {
		const loaded = loadProviderGroupOnboarding();

		await loaded.module.showAddProviderGroupGuide();

		assert.equal(loaded.informationCalls.length, 1);
		assert.deepEqual(loaded.commandCalls, []);
	});
});
