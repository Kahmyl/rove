import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { startSessionRequestSchema, type StartSessionRequest } from "@rove/protocol";
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
}
