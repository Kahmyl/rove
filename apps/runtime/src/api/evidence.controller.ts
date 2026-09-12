import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import {
  fileArtifactMimeTypeSchema,
  fileArtifactNameSchema,
  MAX_GENERATED_FILE_BYTES,
  MAX_GRANTED_FILE_BYTES,
  RoveError,
  saveEvidenceRequestSchema,
  type SaveEvidenceRequest,
} from "@rove/protocol";
import { RuntimeService } from "../runtime.service.js";

type ByteStreamRequest = AsyncIterable<Uint8Array | string>;

@Controller("sessions/:id/evidence")
export class EvidenceController {
  constructor(
    @Inject(RuntimeService) private readonly runtime: RuntimeService,
  ) {}

  @Post()
  save(@Param("id") id: string, @Body() body: SaveEvidenceRequest) {
    return this.runtime.saveEvidence(id, saveEvidenceRequestSchema.parse(body));
  }

  @Post("files")
  async createFile(
    @Param("id") sessionId: string,
    @Req() request: ByteStreamRequest,
    @Headers("x-rove-file-name") encodedFilename: string | undefined,
    @Headers("x-rove-file-source") sourceHeader: string | undefined,
    @Headers("x-rove-grant-id") grantId: string | undefined,
    @Headers("content-type") contentType: string | undefined,
  ) {
    const source =
      sourceHeader === "agent_generated" || sourceHeader === "user_file_grant"
        ? sourceHeader
        : undefined;
    if (source === undefined) {
      throw new RoveError({
        code: "INVALID_CONFIGURATION",
        message: "File artifact source is missing or invalid.",
      });
    }
    const filename = fileArtifactNameSchema.parse(
      decodeFilename(encodedFilename),
    );
    const mimeType = fileArtifactMimeTypeSchema.parse(
      contentType?.split(";", 1)[0]?.trim() || "application/octet-stream",
    );
    const limit =
      source === "agent_generated"
        ? MAX_GENERATED_FILE_BYTES
        : MAX_GRANTED_FILE_BYTES;
    const bytes = await readBoundedBytes(request, limit);
    return this.runtime.materializeFileEvidence(sessionId, {
      filename,
      mimeType,
      bytes,
      source,
      ...(grantId === undefined ? {} : { grantId }),
    });
  }

  @Get()
  list(@Param("id") id: string) {
    return this.runtime.listEvidence(id);
  }

  @Delete("files/grants/:grantId")
  deleteGrant(
    @Param("id") sessionId: string,
    @Param("grantId") grantId: string,
  ) {
    return this.runtime.deleteFileGrant(sessionId, grantId);
  }

  @Get(":evidenceId")
  read(@Param("id") id: string, @Param("evidenceId") evidenceId: string) {
    return this.runtime.readEvidence(id, evidenceId);
  }
}

function decodeFilename(value: string | undefined): string {
  if (
    value === undefined ||
    value.length === 0 ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    throw new RoveError({
      code: "INVALID_CONFIGURATION",
      message: "File artifact name header is missing or invalid.",
    });
  }
  return Buffer.from(value, "base64url").toString("utf8");
}

async function readBoundedBytes(
  request: ByteStreamRequest,
  limit: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes =
      typeof chunk === "string" ? Buffer.from(chunk) : new Uint8Array(chunk);
    size += bytes.byteLength;
    if (size > limit) {
      throw new RoveError({
        code: "FILE_ARTIFACT_TOO_LARGE",
        message: `File artifact exceeds the ${limit} byte limit.`,
        details: { limitBytes: limit },
      });
    }
    chunks.push(bytes);
  }
  return new Uint8Array(
    Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))),
  );
}
