import { Controller, Get, Param } from "@nestjs/common";
import { RuntimeService } from "../runtime.service.js";

@Controller("sessions/:id/control")
export class ControlController {
  constructor(private readonly runtime: RuntimeService) {}

  @Get()
  status(@Param("id") id: string) {
    return this.runtime.getControl(id);
  }
}
