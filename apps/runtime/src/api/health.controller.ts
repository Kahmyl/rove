import { Controller, Get } from "@nestjs/common";
import { ROVE_PROTOCOL_VERSION } from "@rove/protocol";
import {
  RUNTIME_PROVENANCE,
  type RuntimeProvenance,
} from "../runtime-provenance.js";

@Controller("health")
export class HealthController {
  @Get()
  getHealth(): {
    ok: true;
    protocolVersion: number;
    runtime: RuntimeProvenance;
  } {
    return {
      ok: true,
      protocolVersion: ROVE_PROTOCOL_VERSION,
      runtime: RUNTIME_PROVENANCE,
    };
  }
}
