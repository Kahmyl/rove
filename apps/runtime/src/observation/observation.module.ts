import { Module } from "@nestjs/common";
import { ObservationService } from "./observation.service.js";

@Module({ providers: [ObservationService], exports: [ObservationService] })
export class ObservationModule {}
