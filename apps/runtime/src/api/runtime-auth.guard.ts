import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { isLoopbackHost, type RoveConfig } from "@rove/config";
import { RoveError } from "@rove/protocol";
import { ROVE_CONFIG } from "../tokens.js";

export function assertRuntimeBindingSafe(config: RoveConfig): void {
  if (!isLoopbackHost(config.runtime.host) && config.runtime.token === undefined) {
    throw new RoveError({ code: "INVALID_CONFIGURATION", message: "A runtime token is required for non-loopback binding." });
  }
}

@Injectable()
export class RuntimeAuthGuard implements CanActivate {
  constructor(@Inject(ROVE_CONFIG) private readonly config: RoveConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ path?: string; url?: string; headers: Record<string, string | string[] | undefined> }>();
    if ((request.path ?? request.url)?.split("?")[0] === "/health") return true;
    const token = this.config.runtime.token;
    if (token === undefined) return true;
    const authorization = request.headers.authorization;
    if (typeof authorization !== "string" || authorization !== `Bearer ${token}`) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
