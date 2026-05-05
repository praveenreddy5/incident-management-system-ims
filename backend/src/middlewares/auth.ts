import type { NextFunction, Request, Response } from "express";

const viewerKey = process.env.VIEWER_API_KEY || "viewer-demo-key";
const operatorKey = process.env.OPERATOR_API_KEY || "operator-demo-key";
const adminKey = process.env.ADMIN_API_KEY || "admin-demo-key";

function roleFromKey(
  apiKey: string | undefined
): "viewer" | "operator" | "admin" | null {
  if (!apiKey) return null;
  if (apiKey === adminKey) return "admin";
  if (apiKey === operatorKey) return "operator";
  if (apiKey === viewerKey) return "viewer";
  return null;
}

export function requireRole(minRole: "viewer" | "operator" | "admin") {
  return (req: Request, res: Response, next: NextFunction): void => {
    const queryKey =
      typeof req.query.apiKey === "string" ? req.query.apiKey : undefined;
    const apiKey = req.header("x-api-key") || queryKey;
    const role = roleFromKey(apiKey);
    if (!role) {
      res.status(401).json({ error: "Missing or invalid API key" });
      return;
    }

    req.context = req.context ?? { traceId: "unknown", role: "viewer" };
    req.context.role = role;

    const rank = { viewer: 1, operator: 2, admin: 3 };
    if (rank[role] < rank[minRole]) {
      res.status(403).json({ error: `Requires ${minRole} role` });
      return;
    }

    next();
  };
}
