import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import tseslint from "typescript-eslint";

export default tseslint.config(js.configs.recommended, ...tseslint.configs.recommended, {
	files: ["src/**/*.ts"],
	plugins: {
		"@stylistic": stylistic,
	},
	languageOptions: {
		parserOptions: {
			project: "./tsconfig.json",
		},
	},
	rules: {
		"@typescript-eslint/no-explicit-any": "off",
		"@typescript-eslint/no-require-imports": "off",
		"@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
		"@stylistic/quotes": ["error", "double", { avoidEscape: true }],
		"@stylistic/semi": ["error", "always"],
	},
});
