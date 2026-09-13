import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import {
  startRecordingRequestSchema,
  type StartRecordingRequest,
} from "@rove/protocol";
import { RuntimeService } from "../runtime.service.js";

@Controller("sessions/:id/recordings")
export class RecordingController {
  constructor(
    @Inject(RuntimeService) private readonly runtime: RuntimeService,
  ) {}

  @Post()
  start(@Param("id") id: string, @Body() body: StartRecordingRequest) {
    return this.runtime.startRecording(
      id,
      startRecordingRequestSchema.parse(body),
    );
  }

  @Get()
  list(@Param("id") id: string) {
    return this.runtime.listRecordings(id);
  }

  @Get(":recordingId")
  get(@Param("id") id: string, @Param("recordingId") recordingId: string) {
    return this.runtime.getRecording(id, recordingId);
  }

  @Post(":recordingId/stop")
  stop(@Param("id") id: string, @Param("recordingId") recordingId: string) {
    return this.runtime.stopRecording(id, recordingId);
  }
}
