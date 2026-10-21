import { and, eq, gt, isNull } from "drizzle-orm";
import { jwtVerify } from "jose";
import { getDatabase, extensionSessions, organizationMembers, permissions, rolePermissions, userRoles } from "@data-vault/database";
import type { DataVaultAuth } from "./better-auth";
import { AppError } from "../lib/errors";
import type { ServerEnvironment } from "@data-vault/config";

export interface Actor { userId: string; extensionSessionId?: string; organizationId?: string }
export interface TenantContext extends Actor { organizationId: string; permissions: Set<string> }

export async function getActor(request: Request, auth: DataVaultAuth, env: ServerEnvironment): Promise<Actor> {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    try {
      const token = authorization.slice(7);
      const { payload } = await jwtVerify(token, new TextEncoder().encode(env.JWT_SECRET), { issuer: env.API_URL, audience: "data-vault-extension" });
      if (typeof payload.sub !== "string" || typeof payload.sid !== "string") throw new Error("Invalid token claims");
      const [session] = await getDatabase().select({ id: extensionSessions.id, organizationId: extensionSessions.organizationId }).from(extensionSessions).where(and(eq(extensionSessions.id, payload.sid), eq(extensionSessions.userId, payload.sub), isNull(extensionSessions.revokedAt), gt(extensionSessions.expiresAt, new Date()))).limit(1);
      if (!session) throw new Error("Session is no longer active");
      return { userId: payload.sub, extensionSessionId: payload.sid, organizationId: session.organizationId };
    } catch {
      throw new AppError(401, "SESSION_EXPIRED", "Your extension session has expired. Please sign in again.");
    }
  }
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Please sign in to continue.");
  return { userId: session.user.id };
}

export async function getTenantContext(request: Request, auth: DataVaultAuth, env: ServerEnvironment, requiredPermission?: string): Promise<TenantContext> {
  const actor = await getActor(request, auth, env);
  const requested = request.headers.get("x-organization-id");
  /**
   * An extension token is bound to the workspace it was authorised for, so
   * a token that was taken cannot be pointed at another one.
   */
  if (actor.organizationId && requested && requested !== actor.organizationId) {
    throw new AppError(403, "ORGANIZATION_ACCESS_DENIED", "This extension session is for a different workspace.");
  }
  const organizationId = actor.organizationId ?? requested;
  if (!organizationId) throw new AppError(400, "ORGANIZATION_REQUIRED", "Select a workspace to continue.");
  const [membership] = await getDatabase().select({ id: organizationMembers.id }).from(organizationMembers).where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, actor.userId), eq(organizationMembers.status, "active"))).limit(1);
  if (!membership) throw new AppError(403, "ORGANIZATION_ACCESS_DENIED", "You do not have access to this workspace.");
  const rows = await getDatabase().select({ key: permissions.key }).from(userRoles).innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId)).innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId)).where(and(eq(userRoles.organizationId, organizationId), eq(userRoles.userId, actor.userId)));
  const granted = new Set(rows.map((row) => row.key));
  if (requiredPermission && !granted.has(requiredPermission)) throw new AppError(403, "PERMISSION_DENIED", "You do not have permission to perform this action.");
  return { ...actor, organizationId, permissions: granted };
}
