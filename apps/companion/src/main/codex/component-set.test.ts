import { describe, expect, it } from "vitest";

import approvedComponentsJson from "./approved-components.json" with { type: "json" };
import compiledSchemaBindingsJson from "./compiled-schema-bindings.json" with { type: "json" };
import {
  resolveApprovedCodexComponentSet,
  type ApprovedCodexComponent,
  type CompiledCodexSchemaBinding,
} from "./component-set.js";

const manifest = approvedComponentsJson as unknown as {
  selection: string;
  components: ApprovedCodexComponent[];
};
const bindings =
  compiledSchemaBindingsJson.bindings as CompiledCodexSchemaBinding[];

describe("qualified Codex component set", () => {
  it("binds the selected executable identity to its exact runtime schema", () => {
    const selected = resolveApprovedCodexComponentSet(manifest, bindings);

    expect(selected.component.id).toBe(manifest.selection);
    expect(selected.schemaCatalog.generatedBy).toContain(
      selected.component.cliVersion,
    );
    expect(selected.binding.aggregateSha256).toBe(
      selected.component.schema.aggregateSha256,
    );
  });

  it("rolls back the runtime validator and history profile with the component", () => {
    const retained = manifest.components.find(
      (component) => component.status === "retained-qualified",
    );
    expect(retained).toBeDefined();

    const rolledBack = resolveApprovedCodexComponentSet(
      { ...manifest, selection: retained!.id },
      bindings,
    );

    expect(rolledBack.component.cliVersion).toBe("0.153.4");
    expect(rolledBack.schemaCatalog.generatedBy).toContain("0.153.4");
    expect(rolledBack.binding.filename).toBe(retained!.schema.filename);
    expect(rolledBack.binding.historyMode).toBe(retained!.historyMode);
  });

  it("refuses a selected component whose compiled binding is absent or mismatched", () => {
    expect(() => resolveApprovedCodexComponentSet(manifest, [])).toThrow(
      /no compiled schema binding/,
    );
    expect(() =>
      resolveApprovedCodexComponentSet(manifest, [
        { ...bindings[0]!, sha256: "substituted-schema" },
      ]),
    ).toThrow(/does not match its compiled schema binding/);
  });
});
