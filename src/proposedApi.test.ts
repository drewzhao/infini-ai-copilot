import assert from "assert/strict";

const Module = require("module") as any;
const originalLoad = Module._load;
Module._load = (request: string, parent: unknown, isMain: boolean) => {
	if (request === "vscode") {
		return {};
	}
	return originalLoad(request, parent, isMain);
};
const { _resetThinkingPartCache, _setThinkingPartCtorForTest, getThinkingPartCtor, hasThinkingPartApi } =
	require("./proposedApi") as typeof import("./proposedApi");
Module._load = originalLoad;

describe("proposedApi capability detector", () => {
	afterEach(() => {
		_resetThinkingPartCache();
	});

	it("returns undefined when the host does not expose LanguageModelThinkingPart", () => {
		_resetThinkingPartCache();
		assert.equal(getThinkingPartCtor(), undefined);
		assert.equal(hasThinkingPartApi(), false);
	});

	it("returns the constructor once one is injected via the test seam", () => {
		class FakeThinkingPart {
			constructor(
				public value: string | string[],
				public id?: string
			) {}
		}
		_setThinkingPartCtorForTest(FakeThinkingPart as unknown as ReturnType<typeof getThinkingPartCtor>);

		const Ctor = getThinkingPartCtor();
		assert.ok(Ctor, "expected ctor to be returned");
		assert.equal(hasThinkingPartApi(), true);

		const part = new Ctor!("hello", "tid");
		assert.equal((part as unknown as { value: string }).value, "hello");
		assert.equal((part as unknown as { id?: string }).id, "tid");
	});

	it("caches results until reset", () => {
		_resetThinkingPartCache();
		assert.equal(hasThinkingPartApi(), false, "first call: nothing exposed");
		assert.equal(hasThinkingPartApi(), false, "second call: cached negative result");

		_resetThinkingPartCache();
		_setThinkingPartCtorForTest(function FakeCtor() {} as unknown as ReturnType<typeof getThinkingPartCtor>);
		assert.equal(hasThinkingPartApi(), true, "after reset + inject: detected");
	});
});
