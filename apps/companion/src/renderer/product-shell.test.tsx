import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  resolveShellComposition,
  ShellSecondarySurface,
} from "./product-shell.js";

describe("responsive secondary surface allocation", () => {
  it("discloses secondary regions before starving conversation at each threshold", () => {
    expect(resolveShellComposition(820, false, true)).toEqual({
      mode: "compact",
      navigation: false,
      inspector: false,
    });
    expect(resolveShellComposition(967, false, true).navigation).toBe(false);
    expect(resolveShellComposition(968, false, true)).toEqual({
      mode: "standard",
      navigation: true,
      inspector: false,
    });
    expect(resolveShellComposition(1180, false, true).inspector).toBe(false);
    expect(resolveShellComposition(1279, false, true).inspector).toBe(false);
    expect(resolveShellComposition(1280, false, true)).toEqual({
      mode: "wide",
      navigation: true,
      inspector: true,
    });
    expect(1280 - 240 - 280 - 48).toBeGreaterThanOrEqual(680);
  });
  it("keeps a stored collapse preference independent of viewport disclosure and optional inspector", () => {
    expect(resolveShellComposition(820, true, true)).toEqual(
      resolveShellComposition(820, false, true),
    );
    expect(resolveShellComposition(1180, true, true).navigation).toBe(false);
    expect(resolveShellComposition(1280, false, false)).toEqual({
      mode: "standard",
      navigation: true,
      inspector: false,
    });
  });
  it("retains hidden content and gives an open drawer a named modal and close control", () => {
    const render = (open: boolean) =>
      renderToStaticMarkup(
        <ShellSecondarySurface
          name="inspector"
          label="Task inspector"
          className="product-inspector"
          inline={false}
          open={open}
          suspended={false}
          onClose={() => undefined}
        >
          <button>Open Browser</button>
        </ShellSecondarySurface>,
      );
    expect(render(false)).toContain('hidden=""');
    expect(render(false)).toContain("Open Browser");
    expect(render(false)).not.toContain('aria-modal="true"');
    expect(render(true)).toContain('role="dialog" aria-modal="true"');
    expect(render(true)).toContain('aria-label="Close inspector"');
  });
});
