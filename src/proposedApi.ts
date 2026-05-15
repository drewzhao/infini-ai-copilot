import * as vscode from "vscode";

/**
 * Capability detector for the proposed `LanguageModelThinkingPart` API.
 *
 * The constructor is exposed on the `vscode` namespace only when:
 *   1. The extension manifest declares `enabledApiProposals: ["languageModelThinkingPart"]`, AND
 *   2. The host permits proposed APIs for this publisher — i.e. VS Code Insiders
 *      with `--enable-proposed-api drewzhao.infiniai-copilot` (or an entry in
 *      `argv.json`), or a Microsoft allowlist entry.
 *
 * On stable VS Code without the runtime flag, this returns undefined and the
 * extension falls back to force-disabling thinking mode for affected models.
 */
type ThinkingPartCtor = new (
	value: string | string[],
	id?: string,
	metadata?: { readonly [key: string]: unknown }
) => vscode.LanguageModelThinkingPart;

let _cached: ThinkingPartCtor | null | undefined = undefined;

function lookup(): ThinkingPartCtor | undefined {
	// Read from the underlying module rather than the TS `import * as vscode`
	// binding, because `__importStar` produces a snapshot copy and would not
	// reflect runtime additions made by the host (or stubs in tests).
	let mod: Record<string, unknown>;
	try {
		mod = require("vscode") as Record<string, unknown>;
	} catch {
		mod = vscode as unknown as Record<string, unknown>;
	}
	const ctor = mod.LanguageModelThinkingPart ?? (vscode as unknown as Record<string, unknown>).LanguageModelThinkingPart;
	return typeof ctor === "function" ? (ctor as ThinkingPartCtor) : undefined;
}

/**
 * Returns the `LanguageModelThinkingPart` constructor when the host has the
 * proposed API enabled for this extension; otherwise undefined.
 */
export function getThinkingPartCtor(): ThinkingPartCtor | undefined {
	if (_cached === undefined) {
		_cached = lookup() ?? null;
	}
	return _cached ?? undefined;
}

/** True iff the host exposes `LanguageModelThinkingPart` to this extension. */
export function hasThinkingPartApi(): boolean {
	return getThinkingPartCtor() !== undefined;
}

/** Test-only: clear the cached lookup so a test can re-stub `vscode`. */
export function _resetThinkingPartCache(): void {
	_cached = undefined;
}

/**
 * Test-only: explicitly set (or clear) the cached constructor without going
 * through the runtime `vscode` lookup. Required because the test harness
 * replaces `require("vscode")` with a fresh `{}` object on every call, so
 * mutating the namespace from outside the module cannot reach the binding
 * captured here.
 */
export function _setThinkingPartCtorForTest(ctor: ThinkingPartCtor | undefined): void {
	_cached = ctor ?? null;
}
