import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { saveEvidenceRequestSchema, type SaveEvidenceRequest } from "@rove/protocol";
import { RuntimeService } from "../runtime.service.js";

@Controller("sessions/:id/evidence")
export class EvidenceController {
  constructor(private readonly runtime: RuntimeService) {}

  @Post()
  save(@Param("id") id: string, @Body() request: SaveEvidenceRequest) {
    return this.runtime.saveEvidence(id, saveEvidenceRequestSchema.parse(request));
  }

  @Get()
  list(@Param("id") id: string) {
    return this.runtime.listEvidence(id);
  }

  @Get(":evidenceId")
  read(@Param("id") id: string, @Param("evidenceId") evidenceId: string) {
    return this.runtime.readEvidence(id, evidenceId);
  }
}
