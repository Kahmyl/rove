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
  prepareTaskResultActionRequestSchema,
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

  @Post(":id/effects/authorize-task-result")
  async authorizeTaskResultAction(
    @Param("id") id: string,
    @Body()
    body: {
      consequenceKey?: unknown;
      materialDigest?: unknown;
      planId?: unknown;
    },
  ) {
    if (
      !body ||
      Object.keys(body).some(
        (key) =>
          key !== "consequenceKey" &&
          key !== "materialDigest" &&
          key !== "planId",
      ) ||
      typeof body.consequenceKey !== "string" ||
      typeof body.materialDigest !== "string" ||
      typeof body.planId !== "string"
    )
      throw new RoveError({
        code: "INVALID_CONFIGURATION",
        message: "Task-result action authorization request is invalid.",
      });
    const record = await this.runtime.authorizeTaskResultAction(
      id,
      body.consequenceKey,
      body.materialDigest,
      body.planId,
    );
    return {
      effectId: record.effectId,
      state: record.state,
      consequenceKey: record.consequenceKey,
    };
  }

  @Post(":id/effects/prepare-task-result")
  prepareTaskResultAction(@Param("id") id: string, @Body() body: unknown) {
    return this.runtime.prepareTaskResultAction(
      id,
      prepareTaskResultActionRequestSchema.parse(body),
    );
  }

  @Get(":id/effects/consequential")
  async consequentialEffect(
    @Param("id") id: string,
    @Query("consequenceKey") consequenceKey?: string,
  ) {
    if (
      typeof consequenceKey !== "string" ||
      consequenceKey.trim().length < 1 ||
      consequenceKey.length > 500
    )
      throw new RoveError({
        code: "INVALID_CONFIGURATION",
        message: "Consequential effect query is invalid.",
      });
    const record = await this.runtime.consequentialEffect(id, consequenceKey);
    return record
      ? {
          effectId: record.effectId,
          state: record.state,
          consequenceKey: record.consequenceKey,
          ...(record.observationId
            ? { observationId: record.observationId }
            : {}),
          ...(record.evidenceId ? { evidenceId: record.evidenceId } : {}),
          ...(record.taskResultPlan
            ? { taskResultPlan: record.taskResultPlan }
            : {}),
        }
      : null;
  }
}
