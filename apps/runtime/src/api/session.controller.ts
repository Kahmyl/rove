import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import {
  sessionModeSchema,
  startSessionRequestSchema,
  type StartSessionRequest,
} from "@rove/protocol";

import { RuntimeService } from "../runtime.service.js";

@Controller("sessions")
export class SessionController {
  constructor(
    @Inject(RuntimeService)
    private readonly runtime: RuntimeService,
  ) {}

  @Post()
  start(@Body() request: StartSessionRequest) {
    return this.runtime.startSession(
      startSessionRequestSchema.parse(request),
    );
  }

  @Get()
  list(@Query("mode") mode?: string) {
    const parsedMode =
      mode === undefined
        ? undefined
        : sessionModeSchema.parse(mode);

    return this.runtime.listActiveSessions(parsedMode);
  }

  @Get(":id")
  status(@Param("id") id: string) {
    return this.runtime.getSession(id);
  }

  @Post(":id/end")
  end(@Param("id") id: string) {
    return this.runtime.endSession(id);
  }
}
