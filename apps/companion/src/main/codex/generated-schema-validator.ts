export type GeneratedSchema =
  | boolean
  | {
      $ref?: string;
      type?: "object" | "array" | "string" | "number" | "boolean" | "null";
      const?: unknown;
      anyOf?: GeneratedSchema[];
      properties?: Record<string, GeneratedSchema>;
      required?: string[];
      additionalProperties?: boolean | GeneratedSchema;
      items?: GeneratedSchema;
      prefixItems?: GeneratedSchema[];
      minItems?: number;
      maxItems?: number;
    };

export interface GeneratedSchemaCatalog {
  generatedBy: string;
  generatedTsAggregateSha256: string;
  roots: {
    clientParams: Record<string, GeneratedSchema>;
    clientResponses: Record<string, GeneratedSchema>;
    notifications: Record<string, GeneratedSchema>;
    serverRequests: Record<string, GeneratedSchema>;
    serverResponses: Record<string, GeneratedSchema>;
  };
  $defs: Record<string, GeneratedSchema>;
}

function valueKind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function validate(
  catalog: GeneratedSchemaCatalog,
  schema: GeneratedSchema,
  value: unknown,
  path: string,
): void {
  if (schema === true) return;
  if (schema === false) throw new Error(`${path} is not permitted.`);
  if (schema.$ref) {
    const prefix = "#/$defs/";
    if (!schema.$ref.startsWith(prefix))
      throw new Error(`Unsupported generated schema reference ${schema.$ref}.`);
    const referenced = catalog.$defs[schema.$ref.slice(prefix.length)];
    if (referenced === undefined)
      throw new Error(`Missing generated schema reference ${schema.$ref}.`);
    validate(catalog, referenced, value, path);
    return;
  }
  if (schema.anyOf) {
    const errors: string[] = [];
    for (const alternative of schema.anyOf) {
      try {
        validate(catalog, alternative, value, path);
        return;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    throw new Error(
      `${path} does not match the generated union: ${errors.join("; ")}`,
    );
  }
  if ("const" in schema && !Object.is(value, schema.const))
    throw new Error(`${path} must equal ${JSON.stringify(schema.const)}.`);
  if (!schema.type) return;
  if (valueKind(value) !== schema.type)
    throw new Error(`${path} must be ${schema.type}.`);

  if (schema.type === "array") {
    const items = value as unknown[];
    if (schema.minItems !== undefined && items.length < schema.minItems)
      throw new Error(`${path} has too few items.`);
    if (schema.maxItems !== undefined && items.length > schema.maxItems)
      throw new Error(`${path} has too many items.`);
    if (schema.prefixItems) {
      for (const [index, itemSchema] of schema.prefixItems.entries())
        validate(catalog, itemSchema, items[index], `${path}[${index}]`);
    } else if (schema.items) {
      for (const [index, item] of items.entries())
        validate(catalog, schema.items, item, `${path}[${index}]`);
    }
    return;
  }

  if (schema.type === "object") {
    const record = value as Record<string, unknown>;
    for (const field of schema.required ?? []) {
      if (!Object.hasOwn(record, field))
        throw new Error(`${path} is missing required field ${field}.`);
    }
    for (const [field, fieldValue] of Object.entries(record)) {
      const property = schema.properties?.[field];
      if (property !== undefined) {
        validate(catalog, property, fieldValue, `${path}.${field}`);
        continue;
      }
      if (schema.additionalProperties === false)
        throw new Error(`${path} contains unsupported field ${field}.`);
      if (
        schema.additionalProperties !== undefined &&
        schema.additionalProperties !== true
      )
        validate(
          catalog,
          schema.additionalProperties,
          fieldValue,
          `${path}.${field}`,
        );
    }
  }
}

export function assertGeneratedSchema(
  catalog: GeneratedSchemaCatalog,
  schema: GeneratedSchema | undefined,
  value: unknown,
  label: string,
): void {
  if (schema === undefined)
    throw new Error(`No pinned generated schema exists for ${label}.`);
  validate(catalog, schema, value, label);
}
