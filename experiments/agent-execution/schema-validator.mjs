function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const supportedKeywords = new Set([
  "$schema",
  "$id",
  "title",
  "type",
  "additionalProperties",
  "required",
  "properties",
  "allOf",
  "if",
  "then",
  "else",
  "not",
  "const",
  "enum",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minimum",
]);

function isRfc3339DateTime(value) {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) return false;
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
    ,
    zone,
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > days[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return false;
  if (zone !== "Z") {
    const [zoneHour, zoneMinute] = zone.slice(1).split(":").map(Number);
    if (zoneHour > 23 || zoneMinute > 59) return false;
  }
  return true;
}

export function auditSchema(schema, path = "$") {
  if (!isObject(schema)) throw new Error(`${path}: schema must be an object`);
  for (const key of Object.keys(schema)) {
    if (!supportedKeywords.has(key) && !key.startsWith("x-"))
      throw new Error(`${path}: unsupported schema keyword ${key}`);
  }
  if (
    Object.hasOwn(schema, "$schema") &&
    schema.$schema !== "https://json-schema.org/draft/2020-12/schema"
  )
    throw new Error(`${path}: unsupported schema dialect ${schema.$schema}`);
  for (const keyword of ["$schema", "$id", "title"])
    if (Object.hasOwn(schema, keyword) && typeof schema[keyword] !== "string")
      throw new Error(`${path}.${keyword}: must be a string`);
  if (
    Object.hasOwn(schema, "type") &&
    !["object", "array", "string", "integer", "boolean"].includes(schema.type)
  )
    throw new Error(`${path}: unsupported schema type ${schema.type}`);
  if (
    Object.hasOwn(schema, "additionalProperties") &&
    typeof schema.additionalProperties !== "boolean"
  )
    throw new Error(`${path}.additionalProperties: must be a boolean`);
  if (Object.hasOwn(schema, "required")) {
    if (
      !Array.isArray(schema.required) ||
      schema.required.some((item) => typeof item !== "string") ||
      new Set(schema.required).size !== schema.required.length
    )
      throw new Error(`${path}.required: must be an array of unique strings`);
  }
  if (Object.hasOwn(schema, "properties") && !isObject(schema.properties))
    throw new Error(`${path}.properties: must be an object`);
  if (Object.hasOwn(schema, "allOf") && !Array.isArray(schema.allOf))
    throw new Error(`${path}.allOf: must be an array`);
  if (Object.hasOwn(schema, "enum")) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0)
      throw new Error(`${path}.enum: must be a non-empty array`);
    const encoded = schema.enum.map((item) => JSON.stringify(item));
    if (new Set(encoded).size !== encoded.length)
      throw new Error(`${path}.enum: values must be unique`);
  }
  for (const keyword of ["minLength", "maxLength"])
    if (
      Object.hasOwn(schema, keyword) &&
      (!Number.isInteger(schema[keyword]) || schema[keyword] < 0)
    )
      throw new Error(`${path}.${keyword}: must be a non-negative integer`);
  if (
    Object.hasOwn(schema, "minimum") &&
    (typeof schema.minimum !== "number" || !Number.isFinite(schema.minimum))
  )
    throw new Error(`${path}.minimum: must be a finite number`);
  if (
    schema.minLength !== undefined &&
    schema.maxLength !== undefined &&
    schema.minLength > schema.maxLength
  )
    throw new Error(`${path}: minLength must not exceed maxLength`);
  if (Object.hasOwn(schema, "format") && typeof schema.format !== "string")
    throw new Error(`${path}.format: must be a string`);
  if (schema.format && schema.format !== "date-time")
    throw new Error(`${path}: unsupported format ${schema.format}`);
  if (Object.hasOwn(schema, "pattern") && typeof schema.pattern !== "string")
    throw new Error(`${path}.pattern: must be a string`);
  if (schema.pattern) new RegExp(schema.pattern);
  for (const [key, child] of Object.entries(schema.properties ?? {}))
    auditSchema(child, `${path}.properties.${key}`);
  for (const [index, child] of (schema.allOf ?? []).entries())
    auditSchema(child, `${path}.allOf[${index}]`);
  for (const keyword of ["if", "then", "else", "not"])
    if (Object.hasOwn(schema, keyword))
      auditSchema(schema[keyword], `${path}.${keyword}`);
  return schema;
}

function validateSchemaInternal(schema, value, path = "$") {
  const errors = [];
  const add = (message) => errors.push(`${path}: ${message}`);

  if (schema.type === "object" && !isObject(value)) add("must be an object");
  if (schema.type === "array" && !Array.isArray(value)) add("must be an array");
  if (schema.type === "string" && typeof value !== "string")
    add("must be a string");
  if (schema.type === "integer" && !Number.isInteger(value))
    add("must be an integer");
  if (schema.type === "boolean" && typeof value !== "boolean")
    add("must be a boolean");
  if (errors.length > 0) return errors;

  if (Object.hasOwn(schema, "const") && value !== schema.const)
    add(`must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value))
    add("must match an enum value");
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength)
      add("is too short");
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      add("is too long");
    if (schema.pattern && !new RegExp(schema.pattern).test(value))
      add("does not match pattern");
    if (schema.format === "date-time" && !isRfc3339DateTime(value))
      add("is not a date-time");
  }
  if (
    typeof value === "number" &&
    schema.minimum !== undefined &&
    value < schema.minimum
  )
    add(`must be >= ${schema.minimum}`);

  if (isObject(value)) {
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required))
        errors.push(`${path}.${required}: is required`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties ?? {}, key))
          errors.push(`${path}.${key}: is not allowed`);
      }
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, key))
        errors.push(
          ...validateSchemaInternal(childSchema, value[key], `${path}.${key}`),
        );
    }
  }

  for (const child of schema.allOf ?? [])
    errors.push(...validateSchemaInternal(child, value, path));
  if (schema.if) {
    const matches = validateSchemaInternal(schema.if, value, path).length === 0;
    if (matches && schema.then)
      errors.push(...validateSchemaInternal(schema.then, value, path));
    if (!matches && schema.else)
      errors.push(...validateSchemaInternal(schema.else, value, path));
  }
  if (
    schema.not &&
    validateSchemaInternal(schema.not, value, path).length === 0
  )
    add("matches forbidden schema");
  return errors;
}

export function validateSchema(schema, value, path = "$") {
  auditSchema(schema, path);
  return validateSchemaInternal(schema, value, path);
}

export function assertSchema(schema, value) {
  const errors = validateSchema(schema, value);
  if (errors.length > 0) throw new Error(errors.join("; "));
  return value;
}
