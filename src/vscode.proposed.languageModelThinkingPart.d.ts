/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// version: 1
// Vendored from microsoft/vscode src/vscode-dts/vscode.proposed.languageModelThinkingPart.d.ts
// (current proposal shape) so the optional runtime detector can compile.
// Marketplace builds intentionally do not declare `enabledApiProposals`; the
// constructor is expected to be absent on Stable and normal Insiders installs.
// Correct reasoning_content replay is provided by the extension-owned replay
// store, not by this proposed API type shim.

declare module "vscode" {

	export class LanguageModelThinkingPart {
		value: string | string[];
		id?: string;
		metadata?: { readonly [key: string]: any };
		constructor(value: string | string[], id?: string, metadata?: { readonly [key: string]: any });
	}
}
