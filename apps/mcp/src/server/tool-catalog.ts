export const TOOL_CATALOG = [
  "session.start",
  "session.status",
  "session.end",
  "session.observations",
  "browser.navigate",
  "browser.inspect",
  "browser.click",
  "browser.type",
  "browser.press",
  "browser.scroll",
  "browser.back",
  "browser.forward",
  "browser.screenshot",
  "evidence.save_record",
  "evidence.list",
  "evidence.read",
  "control.status",
] as const;

export type RoveToolName = (typeof TOOL_CATALOG)[number];
