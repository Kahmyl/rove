import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  browserInteractionRequestSchema,
  expectedEffectSchema,
  structuralScopeKindSchema,
  targetCapabilitySchema,
  targetKindSchema,
} from "@rove/protocol";

interface AtlasCapability {
  id: string;
  domain: string;
  name: string;
  priority: string;
  risk: string;
  pipeline: string;
  disposition: string;
  experiment: string;
  acceptance: string;
  sources: string[];
  verificationContract?: {
    expectedEffect: string;
    correlation: string;
    truth: string;
  };
}

interface CapabilityAtlas {
  schemaVersion: number;
  pipelineDimensions: string[];
  statusCodes: Record<string, string>;
  currentContract: {
    targetKinds: string[];
    targetCapabilities: string[];
    structuralScopes: string[];
    verifiedInteractions: string[];
    expectedEffects: string[];
  };
  sources: Record<string, string>;
  capabilities: AtlasCapability[];
}

const atlas = JSON.parse(
  readFileSync(
    new URL(
      "../../../../docs/capabilities/web-capability-atlas.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as CapabilityAtlas;

const expectedDomains = [
  "activation",
  "editing",
  "gesture",
  "human_boundary",
  "io",
  "navigation",
  "perception",
  "widgets",
];

const allowedSourceHosts = new Set([
  "fullscreen.spec.whatwg.org",
  "html.spec.whatwg.org",
  "playwright.dev",
  "web-platform-tests.org",
  "www.w3.org",
]);

function discriminatedKinds(schema: unknown): string[] {
  const unwrapped =
    (schema as { _def?: { schema?: unknown } })._def?.schema ?? schema;
  const options = (
    unwrapped as {
      options: Array<{ shape: { kind: { value: string } } }>;
    }
  ).options;

  return options.map((option) => option.shape.kind.value);
}

describe("Web Capability Atlas governance", () => {
  it("covers a broad standards-derived capability inventory", () => {
    expect(atlas.schemaVersion).toBe(1);
    expect(atlas.pipelineDimensions).toEqual([
      "perception",
      "grounding",
      "action",
      "verification",
      "evidence",
      "recovery",
      "safety",
    ]);
    expect(atlas.capabilities.length).toBeGreaterThanOrEqual(65);
    expect(
      [
        ...new Set(atlas.capabilities.map((capability) => capability.domain)),
      ].sort(),
    ).toEqual(expectedDomains);
  });

  it("keeps every entry unique, measurable, sourced, and pipeline-complete", () => {
    const ids = atlas.capabilities.map((capability) => capability.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const capability of atlas.capabilities) {
      expect(capability.id).toMatch(/^[a-z_]+\.[a-z0-9_]+$/);
      expect(capability.name.length).toBeGreaterThan(3);
      expect(["P0", "P1", "P2", "P3"]).toContain(capability.priority);
      expect([
        "observe",
        "navigate",
        "reversible_ui",
        "edit_content",
        "external_commit",
        "credential_entry",
        "irreversible",
        "browser_consent",
      ]).toContain(capability.risk);
      expect(capability.pipeline).toMatch(/^[CPEMHN]{7}$/);
      expect(["retain", "upgrade", "add", "human_boundary"]).toContain(
        capability.disposition,
      );
      expect(capability.experiment.length).toBeGreaterThan(15);
      expect(capability.acceptance.length).toBeGreaterThan(20);
      expect(capability.sources.length).toBeGreaterThan(0);
      for (const source of capability.sources) {
        expect(atlas.sources[source]).toBeDefined();
      }
    }
  });

  it("uses primary specifications and official runtime documentation", () => {
    for (const source of Object.values(atlas.sources)) {
      const url = new URL(source);
      expect(url.protocol).toBe("https:");
      expect(allowedSourceHosts.has(url.hostname)).toBe(true);
    }
  });

  it("mirrors the current protocol so contract drift cannot hide", () => {
    expect(atlas.currentContract.targetKinds).toEqual(targetKindSchema.options);
    expect(atlas.currentContract.targetCapabilities).toEqual(
      targetCapabilitySchema.options,
    );
    expect(atlas.currentContract.structuralScopes).toEqual(
      structuralScopeKindSchema.options,
    );
    expect(atlas.currentContract.verifiedInteractions).toEqual(
      discriminatedKinds(browserInteractionRequestSchema),
    );
    expect(atlas.currentContract.expectedEffects).toEqual(
      discriminatedKinds(expectedEffectSchema),
    );
  });

  it("makes managed-download verification mechanically auditable", () => {
    const download = atlas.capabilities.find(
      (capability) => capability.id === "io.download",
    );
    expect(download?.verificationContract).toEqual({
      expectedEffect: "download_completed",
      correlation: "post_dispatch_action_boundary",
      truth: "persisted_runtime_file_evidence",
    });
    expect(atlas.currentContract.expectedEffects).toContain(
      download?.verificationContract?.expectedEffect,
    );
  });

  it("does not mislabel experimental or human-owned work as production", () => {
    for (const capability of atlas.capabilities) {
      if (capability.disposition === "retain") {
        expect(capability.pipeline).not.toContain("M");
        expect(capability.pipeline).not.toContain("H");
      }
      if (capability.disposition === "human_boundary") {
        expect(capability.pipeline).toContain("H");
      }
      if (capability.pipeline.includes("E")) {
        expect(capability.disposition).not.toBe("retain");
      }
    }
  });
});
