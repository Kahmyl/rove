/* global document, window */

/** Evidence-only pointer; never participates in layout, focus or hit testing. */
export async function installEvidencePointer(page) {
  await page.evaluate(() => {
    const pointer = document.createElement("span");
    pointer.id = "qualification-pointer";
    pointer.setAttribute("aria-hidden", "true");
    Object.assign(pointer.style, {
      position: "fixed",
      width: "8px",
      height: "8px",
      borderRadius: "50%",
      border: "1px solid #ffffff",
      background: "#985c3d",
      boxShadow: "0 0 0 1px #20201e",
      pointerEvents: "none",
      zIndex: "2147483647",
      display: "none",
    });
    document.body.append(pointer);
    const events = [];
    const locate = (event) => {
      pointer.style.display = "block";
      // Offset the witness from its target rather than painting over text or icons.
      pointer.style.left = `${Math.max(1, Math.min(window.innerWidth - 10, event.clientX + 12))}px`;
      pointer.style.top = `${Math.max(1, Math.min(window.innerHeight - 10, event.clientY + 12))}px`;
    };
    document.addEventListener("pointermove", locate, true);
    document.addEventListener(
      "pointerdown",
      (event) => {
        locate(event);
        pointer.style.background = "#d38b5e";
        events.push({
          type: "pointer",
          x: event.clientX,
          y: event.clientY,
          label:
            event.target.closest("button")?.getAttribute("aria-label") ??
            event.target.closest("button")?.textContent?.slice(0, 100) ??
            null,
        });
      },
      true,
    );
    document.addEventListener(
      "keydown",
      (event) => {
        pointer.style.display = "none";
        if (["Enter", " ", "Tab", "Escape"].includes(event.key))
          events.push({ type: "keyboard", key: event.key });
      },
      true,
    );
    // Test snapshots expose only bounded interaction evidence, never typed input.
    window.readQualificationPointer = () => ({
      events: events.slice(-12),
      count: events.length,
      pointerEvents: pointer.style.pointerEvents,
      ariaHidden: pointer.getAttribute("aria-hidden"),
      visible: pointer.style.display !== "none",
    });
  });
}
