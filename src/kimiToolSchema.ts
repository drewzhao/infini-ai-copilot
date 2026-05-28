import type { OpenAIFunctionToolDef } from "./openai/openaiTypes";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullSchema(value: unknown): boolean {
	return isRecord(value) && value.type === "null";
}

function inferJsonTypeFromEnum(values: readonly unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === "string") {
			return "string";
		}
		if (typeof value === "number") {
			return Number.isInteger(value) ? "integer" : "number";
		}
		if (typeof value === "boolean") {
			return "boolean";
		}
	}
	return undefined;
}

function cleanEnumValue(value: unknown): boolean {
	return value !== null && value !== "";
}

function sanitizeSchemaValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sanitizeSchemaValue);
	}
	if (!isRecord(value)) {
		return value;
	}

	if (typeof value.$ref === "string") {
		return { $ref: value.$ref };
	}

	const out: JsonRecord = {};
	for (const [key, rawValue] of Object.entries(value)) {
		if (key === "nullable") {
			continue;
		}
		if (key === "anyOf" || key === "oneOf" || key === "allOf") {
			const schemas = Array.isArray(rawValue)
				? rawValue.filter((schema) => !isNullSchema(schema)).map(sanitizeSchemaValue)
				: rawValue;
			if (Array.isArray(schemas) && schemas.length === 0) {
				continue;
			}
			out[key] = schemas;
			continue;
		}
		if (key === "enum" && Array.isArray(rawValue)) {
			const cleaned = rawValue.filter(cleanEnumValue);
			if (cleaned.length > 0) {
				out.enum = cleaned;
			}
			continue;
		}
		if (key === "items" && Array.isArray(rawValue)) {
			out.items = rawValue.length > 0 ? sanitizeSchemaValue(rawValue[0]) : {};
			continue;
		}
		if (key === "properties" || key === "$defs" || key === "definitions") {
			if (!isRecord(rawValue)) {
				continue;
			}
			const entries: JsonRecord = {};
			for (const [name, propertySchema] of Object.entries(rawValue)) {
				entries[name] = sanitizeSchemaValue(propertySchema);
			}
			out[key] = entries;
			continue;
		}
		out[key] = sanitizeSchemaValue(rawValue);
	}

	if (out.anyOf !== undefined || out.oneOf !== undefined || out.allOf !== undefined) {
		delete out.type;
		return out;
	}

	if (out.type === undefined) {
		if (isRecord(out.properties) || Array.isArray(out.required)) {
			out.type = "object";
		} else if (out.items !== undefined) {
			out.type = "array";
		} else if (Array.isArray(out.enum)) {
			const inferred = inferJsonTypeFromEnum(out.enum);
			if (inferred) {
				out.type = inferred;
			}
		} else {
			out.type = "string";
		}
	}

	return out;
}

export function sanitizeKimiToolSchema(schema: unknown): unknown {
	return sanitizeSchemaValue(schema);
}

function sanitizeKimiToolParameters(schema: unknown): OpenAIFunctionToolDef["function"]["parameters"] {
	const sanitized = sanitizeKimiToolSchema(schema);
	if (!isRecord(sanitized)) {
		return { type: "object", properties: {} };
	}
	if (
		sanitized.type === "string" &&
		!Array.isArray(sanitized.enum) &&
		sanitized.properties === undefined &&
		sanitized.items === undefined &&
		sanitized.anyOf === undefined &&
		sanitized.oneOf === undefined &&
		sanitized.allOf === undefined
	) {
		return { type: "object", properties: {} };
	}
	return sanitized as OpenAIFunctionToolDef["function"]["parameters"];
}

export function sanitizeKimiOpenAITools(tools: readonly OpenAIFunctionToolDef[]): OpenAIFunctionToolDef[] {
	return tools.map((tool) => ({
		...tool,
		function: {
			...tool.function,
			parameters: sanitizeKimiToolParameters(tool.function.parameters),
		},
	}));
}
