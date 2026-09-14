import { describe, expect, it, vi } from "vitest";

import { CodexThreadSessionSupervisor } from "./codex-thread-session-supervisor.js";
import type { CodexThread } from "./protocol.js";

function thread(turns: CodexThread["turns"] = []): CodexThread {
  return {
    id: "thread_1",
    extra: null,
    sessionId: "session_1",
    forkedFromId: null,
    parentThreadId: null,
    preview: "",
    ephemeral: false,
    section: null,
    sectionEnteredAt: null,
    projectId: null,
    daybreakEnabled: null,
    environments: null,
    originator: null,
    historyMode: "legacy",
    modelProvider: "openai",
    model: "gpt-test",
    reasoningEffort: "medium",
    createdAt: 1,
    updatedAt: 1,
    recencyAt: 1,
    cwd: "/task",
    cliVersion: "0.154.0-alpha.6.2",
    status: { type: "idle" },
    path: null,
    source: "appServer",
    canAcceptDirectInput: true,
    threadSource: "rove:task:boot",
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns,
  };
}

describe("CodexThreadSessionSupervisor", () => {
  it("pins new tasks to the qualified legacy profile", async () => {
    const request = vi.fn(async () => ({ thread: thread() }));
    const supervisor = new CodexThreadSessionSupervisor({ request } as never);
    await supervisor.start({ cwd: "/task" });
    expect(request).toHaveBeenCalledWith(
      "thread/start",
      expect.objectContaining({
        historyMode: "legacy",
        experimentalRawEvents: false,
      }),
    );
  });

  it("treats missing correlated history as unresolved rather than redispatchable", () => {
    const supervisor = new CodexThreadSessionSupervisor({} as never);
    expect(supervisor.correlate(thread(), "intent_1").state).toBe("unresolved");
  });

  it("recognizes only the exact materialized operation id", () => {
    const supervisor = new CodexThreadSessionSupervisor({} as never);
    const value = thread([
      {
        id: "turn_1",
        items: [
          {
            type: "userMessage",
            id: "item_1",
            clientId: "intent_exact",
            content: [],
          },
        ],
        itemsView: "full",
        status: "completed",
        error: null,
        startedAt: 1,
        completedAt: 2,
        durationMs: 1,
      },
    ]);
    expect(supervisor.correlate(value, "intent_exact")).toMatchObject({
      state: "message_materialized",
      turnId: "turn_1",
    });
    expect(supervisor.correlate(value, "intent_other").state).toBe(
      "unresolved",
    );
  });

  it("will not dispatch on a replacement connection before exact resume", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "thread/start" || method === "thread/resume")
        return { thread: thread() };
      if (method === "turn/start") return { turn: { id: "turn_1" } };
      throw new Error(`Unexpected method ${method}`);
    });
    const supervisor = new CodexThreadSessionSupervisor({ request } as never);
    const started = await supervisor.start({ cwd: "/task" });
    supervisor.replaceConnectionGeneration(2);
    expect(
      (
        await supervisor.dispatch({
          thread: started,
          operationId: "intent_1",
          message: "Continue",
        })
      ).state,
    ).toBe("dispatch_not_started");
    expect(request).not.toHaveBeenCalledWith("turn/start", expect.anything());
    await supervisor.resume({ threadId: started.id });
    expect(
      await supervisor.dispatch({
        thread: started,
        operationId: "intent_1",
        message: "Continue",
      }),
    ).toMatchObject({ state: "acceptance_observed", turnId: "turn_1" });
  });

  it("submits every attachment as part of the user input before the text", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "thread/start") return { thread: thread() };
      if (method === "turn/start") return { turn: { id: "turn_1" } };
      throw new Error(`Unexpected method ${method}`);
    });
    const supervisor = new CodexThreadSessionSupervisor({ request } as never);
    const started = await supervisor.start({ cwd: "/task" });
    await supervisor.dispatch({
      thread: started,
      operationId: "intent_files",
      message: "Use both files",
      attachments: [
        { type: "mention", name: "notes.txt", path: "/task/notes.txt" },
        { type: "localImage", path: "/task/image.png" },
      ],
    });
    expect(request).toHaveBeenCalledWith(
      "turn/start",
      expect.objectContaining({
        input: [
          { type: "mention", name: "notes.txt", path: "/task/notes.txt" },
          { type: "localImage", path: "/task/image.png" },
          { type: "text", text: "Use both files", text_elements: [] },
        ],
      }),
    );
  });
});
