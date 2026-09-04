import { describe, expect, it } from "vitest";

import type { RuntimeClient } from "../runtime/runtime-client.types.js";

import { browserTools } from "./browser.tools.js";

function record(value: unknown): Record<string, unknown> {
  expect(typeof value).toBe("object");

  expect(value).not.toBeNull();

  expect(Array.isArray(value)).toBe(false);

  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  expect(Array.isArray(value)).toBe(true);

  return value as unknown[];
}

function schemaVariant(
  variants: unknown[],
  kind: string,
): Record<string, unknown> {
  const match = variants.find((candidate) => {
    const properties = record(record(candidate).properties);

    const kindSchema = record(properties.kind);

    return kindSchema.const === kind;
  });

  expect(match).toBeDefined();

  return record(match);
}

describe("browser.interact MCP schema", () => {
  it("advertises action-specific required fields", () => {
    const tool = browserTools({} as RuntimeClient).find(
      (candidate) => candidate.name === "browser.interact",
    );

    expect(tool).toBeDefined();

    const properties = record(tool!.inputSchema.properties);

    const action = record(properties.action);

    const variants = array(action.oneOf);

    expect(variants).toHaveLength(11);

    expect(schemaVariant(variants, "fill").required).toEqual([
      "kind",
      "target",
      "value",
    ]);

    expect(schemaVariant(variants, "drag").required).toEqual([
      "kind",
      "target",
      "destination",
    ]);

    expect(schemaVariant(variants, "precise_scroll").required).toEqual([
      "kind",
      "deltaX",
      "deltaY",
    ]);

    expect(schemaVariant(variants, "coordinate_click").required).toEqual([
      "kind",
      "target",
      "observationId",
      "offsetX",
      "offsetY",
    ]);
  });

  it("advertises the bounded expected-effect union", () => {
    const tool = browserTools({} as RuntimeClient).find(
      (candidate) => candidate.name === "browser.interact",
    );

    expect(tool).toBeDefined();

    const properties = record(tool!.inputSchema.properties);

    const expectedEffects = record(properties.expectedEffects);

    const effectSchema = record(expectedEffects.items);

    const variants = array(effectSchema.oneOf);

    expect(variants).toHaveLength(13);

    expect(schemaVariant(variants, "page_opened").required).toEqual(["kind"]);

    expect(schemaVariant(variants, "selected_value").required).toEqual([
      "kind",
      "target",
      "value",
    ]);
  });

  it("advertises the stable consequence-key requirement", () => {
    const tool = browserTools({} as RuntimeClient).find(
      (candidate) => candidate.name === "browser.interact",
    );

    expect(tool).toBeDefined();

    const allOf = array(tool!.inputSchema.allOf);

    expect(allOf).toHaveLength(1);

    const conditional = record(allOf[0]);

    expect(record(conditional.then).required).toEqual(["consequenceKey"]);
  });
});
