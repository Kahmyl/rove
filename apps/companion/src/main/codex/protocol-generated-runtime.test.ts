import { describe, expect, it } from "vitest";

import generatedCatalogJson from "./app-server-0.153.4.schemas.generated.json" with { type: "json" };
import type {
  GeneratedSchema,
  GeneratedSchemaCatalog,
} from "./generated-schema-validator.js";
import {
  parseCodexServerEvent,
  validateCodexRequestParams,
  validateCodexResponse,
  validateServerRequestResponse,
  type CodexMethod,
  type CodexServerNotificationMethod,
  type CodexServerRequestMethod,
} from "./protocol.js";

const catalog = generatedCatalogJson as unknown as GeneratedSchemaCatalog;

function dereference(schema: GeneratedSchema): GeneratedSchema {
  let current = schema;
  const seen = new Set<string>();
  while (current !== true && current !== false && current.$ref) {
    if (seen.has(current.$ref)) return true;
    seen.add(current.$ref);
    current = catalog.$defs[current.$ref.slice("#/$defs/".length)] ?? false;
  }
  return current;
}

function sample(
  schemaValue: GeneratedSchema,
  seen = new Set<string>(),
): unknown {
  if (schemaValue === true) return null;
  if (schemaValue === false)
    throw new Error("Cannot sample an impossible schema.");
  if (schemaValue.$ref) {
    if (seen.has(schemaValue.$ref)) return null;
    const next = new Set(seen).add(schemaValue.$ref);
    return sample(
      catalog.$defs[schemaValue.$ref.slice("#/$defs/".length)] ?? false,
      next,
    );
  }
  if (schemaValue.anyOf) return sample(schemaValue.anyOf[0]!, seen);
  if ("const" in schemaValue) return schemaValue.const;
  if (schemaValue.type === "object")
    return Object.fromEntries(
      (schemaValue.required ?? []).map((field) => [
        field,
        sample(schemaValue.properties?.[field] ?? true, seen),
      ]),
    );
  if (schemaValue.type === "array") return [];
  if (schemaValue.type === "string") return "x";
  if (schemaValue.type === "number") return 1;
  if (schemaValue.type === "boolean") return true;
  if (schemaValue.type === "null") return null;
  return null;
}

type Path = Array<string | number>;
function selected(schemaValue: GeneratedSchema): GeneratedSchema {
  const schema = dereference(schemaValue);
  return schema !== true && schema !== false && schema.anyOf
    ? selected(schema.anyOf[0]!)
    : schema;
}
function mutationPaths(
  schemaValue: GeneratedSchema,
  value: unknown,
  path: Path,
  kind: "required" | "scalar" | "const",
): Path[] {
  const schema = selected(schemaValue);
  if (schema === true || schema === false) return [];
  if (kind === "const" && "const" in schema) return [path];
  if (
    kind === "scalar" &&
    ["string", "number", "boolean", "null"].includes(schema.type ?? "")
  )
    return [path];
  if (schema.type === "object" && value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const own =
      kind === "required"
        ? (schema.required ?? []).map((field) => [...path, field])
        : [];
    return [
      ...own,
      ...Object.entries(record).flatMap(([field, child]) =>
        mutationPaths(
          schema.properties?.[field] ?? true,
          child,
          [...path, field],
          kind,
        ),
      ),
    ];
  }
  if (schema.type === "array" && Array.isArray(value) && schema.items)
    return value.flatMap((child, index) =>
      mutationPaths(schema.items!, child, [...path, index], kind),
    );
  return [];
}
function mutated(
  value: unknown,
  path: Path,
  kind: "required" | "scalar" | "const",
  replacement: unknown = [],
) {
  if (path.length === 0) {
    if (kind === "required") throw new Error("Cannot delete the root.");
    return replacement;
  }
  const copy = structuredClone(value) as Record<string | number, unknown>;
  let target = copy;
  for (const part of path.slice(0, -1))
    target = target[part] as Record<string | number, unknown>;
  const leaf = path.at(-1)!;
  if (kind === "required") delete target[leaf];
  else target[leaf] = replacement;
  return copy;
}

type Family = keyof GeneratedSchemaCatalog["roots"];
function invoke(family: Family, method: string, value: unknown): void {
  if (family === "clientParams")
    validateCodexRequestParams(method as CodexMethod, value as never);
  else if (family === "clientResponses")
    validateCodexResponse(method as CodexMethod, value);
  else if (family === "notifications")
    parseCodexServerEvent(method as CodexServerNotificationMethod, value);
  else if (family === "serverRequests")
    parseCodexServerEvent(method as CodexServerRequestMethod, value, 1);
  else validateServerRequestResponse(method as CodexServerRequestMethod, value);
}

describe("generated 0.153.4 runtime schema catalog", () => {
  it("accepts developer instructions on thread start and resume", () => {
    expect(() =>
      validateCodexRequestParams("thread/start", {
        developerInstructions: "Use only the required Rove MCP route.",
      }),
    ).not.toThrow();
    expect(() =>
      validateCodexRequestParams("thread/resume", {
        threadId: "thread_1",
        developerInstructions: "Use only the required Rove MCP route.",
      }),
    ).not.toThrow();
  });

  it("accepts hosted browser-login fields but rejects them on device code", () => {
    expect(() =>
      validateCodexRequestParams("account/login/start", {
        type: "chatgpt",
        useHostedLoginSuccessPage: true,
        appBrand: "chatgpt",
      }),
    ).not.toThrow();
    expect(() =>
      validateCodexRequestParams("account/login/start", {
        type: "chatgptDeviceCode",
        useHostedLoginSuccessPage: true,
        appBrand: "chatgpt",
      } as never),
    ).toThrow();
  });

  for (const family of Object.keys(catalog.roots) as Family[]) {
    it(`rejects one-field required/type/enum mutations across ${family}`, () => {
      const coverage = { required: 0, scalar: 0, const: 0 };
      for (const [method, schema] of Object.entries(catalog.roots[family])) {
        const valid = sample(schema) as Record<string, unknown>;
        if (
          family === "serverResponses" &&
          method === "item/permissions/requestApproval"
        )
          valid.strictAutoReview = true;
        expect(
          () => invoke(family, method, valid),
          `${family} ${method}`,
        ).not.toThrow();

        for (const kind of ["required", "scalar", "const"] as const) {
          const paths = mutationPaths(schema, valid, [], kind);
          if (paths.length === 0) continue;
          const replacements =
            kind === "required"
              ? [undefined]
              : [[], {}, null, "invalid", 7, false];
          const rejected = paths.some((path) =>
            replacements.some((replacement) => {
              try {
                invoke(family, method, mutated(valid, path, kind, replacement));
                return false;
              } catch {
                return true;
              }
            }),
          );
          if (rejected) coverage[kind] += 1;
        }
      }
      expect(
        coverage.required,
        `${family} required-field coverage`,
      ).toBeGreaterThan(0);
      expect(coverage.scalar, `${family} scalar-type coverage`).toBeGreaterThan(
        0,
      );
      expect(coverage.const, `${family} closed-enum coverage`).toBeGreaterThan(
        0,
      );
    });
  }
});
