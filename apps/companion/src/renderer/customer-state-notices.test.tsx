import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CustomerStateMarkers,
  CustomerStateNotices,
  retainActiveDismissals,
} from "./customer-state-notices.js";

const notice = {
  key: "task:effect",
  owner: "Exact owning Task",
  title: "Outcome unclear",
  description: "Check the affected action before repeating it.",
  tone: "danger" as const,
};
describe("customer state notices", () => {
  it("keeps durable marker details separate from dismissible announcement", () => {
    const marker = renderToStaticMarkup(
      <CustomerStateMarkers
        markers={[notice]}
        id="marker"
        owner={notice.owner}
      />,
    );
    expect(marker).toContain("Outcome unclear");
    expect(marker).toContain("Exact owning Task state details");
    expect(marker).not.toContain('role="status"');
    expect(marker).not.toContain("Dismiss");
    const notification = renderToStaticMarkup(
      <CustomerStateNotices notices={[notice]} activeKeys={[notice.key]} />,
    );
    expect(notification).toContain('role="status"');
    expect(notification).toContain("Dismiss Outcome unclear notification");
    expect(notification).toContain(notice.owner);
  });
  it("retains dismissal across unrelated Task switching but re-arms after authority removes the issue", () => {
    const dismissed = new Set(["task:effect", "device:runtime"]);
    expect(
      retainActiveDismissals(dismissed, ["task:effect", "other:issue"]),
    ).toEqual(new Set(["task:effect"]));
    expect(retainActiveDismissals(dismissed, [])).toEqual(new Set());
    expect([...dismissed]).toEqual(["task:effect", "device:runtime"]);
  });
  it("renders no completion noise or marker when exact issue is absent", () => {
    expect(
      renderToStaticMarkup(
        <CustomerStateMarkers markers={[]} id="marker" owner="Task" />,
      ),
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <CustomerStateNotices notices={[]} activeKeys={[]} />,
      ),
    ).toBe("");
  });
});
