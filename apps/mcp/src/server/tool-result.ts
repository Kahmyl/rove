import {
  RoveError,
} from "@rove/protocol";

import {
  ZodError,
} from "zod";

import {
  RuntimeClientError,
} from "../runtime/runtime-client.error.js";

export type ToolContent =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image";
      data: string;
      mimeType: string;
    };

export interface ToolResult {
  [key: string]: unknown;
  isError?: boolean;
  content: ToolContent[];
}

export function toolSuccess(
  result: unknown,
): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result),
      },
    ],
  };
}

export function toolSuccessWithImage(
  result: unknown,
): ToolResult {
  if (
    typeof result !== "object" ||
    result === null ||
    Array.isArray(result)
  ) {
    return toolSuccess(result);
  }

  const metadata = {
    ...(result as Record<string, unknown>),
  };

  const image =
    metadata.image;

  if (
    typeof image !== "object" ||
    image === null ||
    Array.isArray(image)
  ) {
    return toolSuccess(result);
  }

  const imageRecord =
    image as Record<string, unknown>;

  if (
    typeof imageRecord.data !== "string" ||
    typeof imageRecord.mimeType !== "string"
  ) {
    return toolSuccess(result);
  }

  delete metadata.image;

  return {
    content: [
      {
        type: "text",
        text:
          JSON.stringify(metadata),
      },
      {
        type: "image",
        data:
          imageRecord.data,
        mimeType:
          imageRecord.mimeType,
      },
    ],
  };
}

export function toolFailure(
  error: unknown,
): ToolResult {
  const shape =
    toErrorShape(error);

  return {
    isError: true,
    content: [
      {
        type: "text",
        text:
          JSON.stringify({
            error: shape,
          }),
      },
    ],
  };
}

function toErrorShape(
  error: unknown,
): {
  code: string;
  message: string;
  retryable: boolean;
  details?: unknown;
} {
  if (
    error instanceof
    RuntimeClientError
  ) {
    return {
      code: error.code,
      message: error.message,
      retryable:
        error.retryable,
      ...(error.details === undefined
        ? {}
        : {
            details:
              error.details,
          }),
    };
  }

  if (error instanceof RoveError) {
    return {
      code: error.code,
      message: error.message,
      retryable:
        error.retryable,
      ...(error.details === undefined
        ? {}
        : {
            details:
              error.details,
          }),
    };
  }

  if (error instanceof ZodError) {
    return {
      code:
        "INVALID_INPUT",
      message:
        "Invalid MCP tool input.",
      retryable: false,
      details:
        error.issues,
    };
  }

  return {
    code:
      "MCP_TOOL_ERROR",
    message:
      error instanceof Error
        ? error.message
        : "Unknown MCP tool failure.",
    retryable: false,
  };
}
