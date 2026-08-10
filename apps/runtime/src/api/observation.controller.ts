import { Controller, Get, Inject, Param, Query } from "@nestjs/common";
import { observationQuerySchema } from "@rove/protocol";
import { RuntimeService } from "../runtime.service.js";

@Controller("sessions/:id/observations")
export class ObservationController {
  constructor(@Inject(RuntimeService) private readonly runtime: RuntimeService) {}

  @Get()
  list(@Param("id") id: string, @Query("afterSeq") afterSeq?: string, @Query("limit") limit?: string) {
    const query = observationQuerySchema.parse({
      ...(afterSeq === undefined ? {} : { afterSeq: Number(afterSeq) }),
      ...(limit === undefined ? {} : { limit: Number(limit) }),
    });
    return this.runtime.getObservations(id, query);
  }
}
