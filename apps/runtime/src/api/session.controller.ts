import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { observationQuerySchema, startSessionRequestSchema, type StartSessionRequest } from "@rove/protocol";
import { RuntimeService } from "../runtime.service.js";

@Controller("sessions")
export class SessionController {
  constructor(private readonly runtime: RuntimeService) {}

  @Post()
  start(@Body() request: StartSessionRequest) {
    return this.runtime.startSession(startSessionRequestSchema.parse(request));
  }

  @Get(":id")
  status(@Param("id") id: string) { return this.runtime.getSession(id); }

  @Post(":id/end")
  end(@Param("id") id: string) { return this.runtime.endSession(id); }

  @Get(":id/observations")
  observations(@Param("id") id: string, @Query() query: Record<string, string | undefined>) {
    return this.runtime.getObservations(
      id,
      observationQuerySchema.parse({
        afterSeq: query.afterSeq === undefined ? undefined : Number(query.afterSeq),
        limit: query.limit === undefined ? undefined : Number(query.limit),
      }),
    );
  }
}
