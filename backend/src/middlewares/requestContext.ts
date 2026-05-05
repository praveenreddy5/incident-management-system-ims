import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";

export interface RequestContext {
  traceId: string;
  role: "viewer" | "operator" | "admin";
}

declare global {
  namespace Express {
    interface Request {
      context?: RequestContext;
    }
  }
}

export function requestContext(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const incomingTraceId = req.header("x-correlation-id");
  const traceId = incomingTraceId?.trim() || randomUUID();

  req.context = {
    traceId,
    role: "viewer",
  };
  res.setHeader("x-correlation-id", traceId);
  next();
}
