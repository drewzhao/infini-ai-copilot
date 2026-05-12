/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// version: 1
// Vendored from microsoft/vscode src/vscode-dts/vscode.proposed.languageModelThinkingPart.d.ts
// for compile-time access. Runtime gating still requires the host to actually
// expose `vscode.LanguageModelThinkingPart` (Insiders + allowlist or
// `--enable-proposed-api drewzhao.infiniai-copilot`). On stable VS Code the
// constructor is undefined and the extension falls back to disable behavior.

declare module "vscode" {

	export class LanguageModelThinkingPart {
		value: string | string[];
		id?: string;
		metadata?: { readonly [key: string]: any };
		constructor(value: string | string[], id?: string, metadata?: { readonly [key: string]: any });
	}
}
