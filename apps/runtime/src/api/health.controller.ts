import { Controller, Get } from "@nestjs/common";
import { ROVE_PROTOCOL_VERSION } from "@rove/protocol";

@Controller("health")
export class HealthController {
  @Get()
  getHealth(): { ok: true; protocolVersion: number } {
    return { ok: true, protocolVersion: ROVE_PROTOCOL_VERSION };
  }
}
