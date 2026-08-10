import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res } from "@nestjs/common";
import { controlWaitRequestSchema, requestHumanRequestSchema, type RequestHumanRequest } from "@rove/protocol";
import { RuntimeService } from "../runtime.service.js";

interface RequestEvents {
  on(event: "aborted", listener: () => void): void;
  off(event: "aborted", listener: () => void): void;
}

interface ResponseEvents {
  writableEnded: boolean;
  on(event: "close", listener: () => void): void;
  off(event: "close", listener: () => void): void;
}

@Controller("sessions/:id/control")
export class ControlController {
  constructor(@Inject(RuntimeService) private readonly runtime: RuntimeService) {}

  @Get() status(@Param("id") id: string) { return this.runtime.getControlStatus(id); }

  @Post("request-human")
  requestHuman(@Param("id") id: string, @Body() body: RequestHumanRequest) {
    return this.runtime.requestHuman(id, requestHumanRequestSchema.parse(body));
  }

  @Post("take") take(@Param("id") id: string) { return this.runtime.takeHumanControl(id); }
  @Post("return") return(@Param("id") id: string) { return this.runtime.returnAgentControl(id); }

  @Get("wait")
  async wait(
    @Param("id") id: string,
    @Query("afterSeq") afterSeq: string | undefined,
    @Query("timeoutMs") timeoutMs: string | undefined,
    @Req() request: RequestEvents,
    @Res({ passthrough: true }) response: ResponseEvents,
  ) {
    const input = controlWaitRequestSchema.parse({
      ...(afterSeq === undefined ? {} : { afterSeq: Number(afterSeq) }),
      ...(timeoutMs === undefined ? {} : { timeoutMs: Number(timeoutMs) }),
    });
    const abort = new AbortController();
    const cancel = () => { if (!response.writableEnded) abort.abort(); };
    request.on("aborted", cancel);
    response.on("close", cancel);
    try {
      return await this.runtime.waitForControl(id, input, abort.signal);
    } catch (error) {
      if (abort.signal.aborted) return undefined;
      throw error;
    } finally {
      request.off("aborted", cancel);
      response.off("close", cancel);
    }
  }
}
