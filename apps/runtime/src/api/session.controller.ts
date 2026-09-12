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
  RoveError,
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
    return this.runtime.startSession(startSessionRequestSchema.parse(request));
  }

  @Get()
  list(@Query("mode") mode?: string) {
    const parsedMode =
      mode === undefined ? undefined : sessionModeSchema.parse(mode);

    return this.runtime.listActiveSessions(parsedMode);
  }

  @Get("inventory")
  inventory(@Query("mode") mode?: string) {
    const parsedMode =
      mode === undefined ? undefined : sessionModeSchema.parse(mode);
    return this.runtime.listSessionInventory(parsedMode);
  }

  @Get(":id")
  status(@Param("id") id: string) {
    return this.runtime.getSession(id);
  }

  @Post(":id/end")
  end(@Param("id") id: string) {
    return this.runtime.endSession(id);
  }

  @Post(":id/recover")
  recover(@Param("id") id: string) {
    return this.runtime.recoverSession(id);
  }

  @Post(":id/effects/acknowledge-legacy")
  async acknowledgeLegacyEffects(@Param("id") id: string) {
    await this.runtime.acknowledgeLegacyEffectScope(id);
    return { acknowledged: true };
  }

  @Post(":id/effects/authorize-repeat")
  async authorizeEffectRepeat(
    @Param("id") id: string,
    @Body() body: { effectId?: unknown; authorizationId?: unknown },
  ) {
    if (
      !body ||
      Object.keys(body).some(
        (key) => key !== "effectId" && key !== "authorizationId",
      ) ||
      typeof body.effectId !== "string" ||
      !/^[a-f0-9]{64}$/.test(body.effectId) ||
      typeof body.authorizationId !== "string" ||
      !/^effect_repeat_[a-f0-9-]{36}$/.test(body.authorizationId)
    )
      throw new RoveError({
        code: "INVALID_CONFIGURATION",
        message: "Effect repeat authorization request is invalid.",
      });
    const record = await this.runtime.authorizeEffectRepetition(
      id,
      body.effectId,
      body.authorizationId,
    );
    return {
      effectId: record.effectId,
      authorizationId: record.repeatAuthorization!.authorizationId,
      authorizedAt: record.repeatAuthorization!.authorizedAt,
    };
  }
}
