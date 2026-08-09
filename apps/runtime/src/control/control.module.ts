import { Module } from "@nestjs/common";
import { ControlService } from "./control.service.js";

@Module({ providers: [ControlService], exports: [ControlService] })
export class ControlModule {}
