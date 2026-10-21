import { and, eq, inArray } from "drizzle-orm";
import { BUILT_IN_ROLES, PERMISSIONS } from "@data-vault/schemas";
import { categories, getDatabase, organizationMembers, organizations, paymentMethods, permissions, rolePermissions, roles, setTenantContext, userRoles } from "@data-vault/database";
import type { Organization } from "@data-vault/types";
import type { z } from "zod";
import type { organizationCreateSchema } from "@data-vault/schemas";
import { createDefaultVault } from "./vaults";

type OrganizationInput = z.infer<typeof organizationCreateSchema>;

const rolePermissionsMap: Record<(typeof BUILT_IN_ROLES)[number], readonly string[]> = {
  super_admin: PERMISSIONS,
  admin: PERMISSIONS.filter((key) => key !== "settings.manage"),
  accountant: PERMISSIONS.filter((key) => !["users.manage", "settings.manage"].includes(key) && !key.endsWith(".archive") && !key.endsWith(".delete")),
  viewer: PERMISSIONS.filter((key) => key.endsWith(".read")),
  custom: [],
};

export async function ensurePermissionCatalog() {
  const db = getDatabase();
  await db.transaction(async (tx) => {
    await tx.insert(permissions).values(PERMISSIONS.map((key) => ({ key, description: key.split(".").join(" ") }))).onConflictDoNothing();
    const [permissionRows, builtInRoles] = await Promise.all([
      tx.select().from(permissions),
      tx.select({ id: roles.id, slug: roles.slug }).from(roles),
    ]);
    for (const role of builtInRoles) {
      const keys = rolePermissionsMap[role.slug as keyof typeof rolePermissionsMap];
      if (!keys) continue;
      const permissionIds = permissionRows.filter((permission) => keys.includes(permission.key)).map((permission) => permission.id);
      if (permissionIds.length) await tx.insert(rolePermissions).values(permissionIds.map((permissionId) => ({ roleId: role.id, permissionId }))).onConflictDoNothing();
    }
  });
}

export async function createOrganization(userId: string, input: OrganizationInput, options: { isPersonal?: boolean } = {}): Promise<Organization> {
  const db = getDatabase();
  await ensurePermissionCatalog();
  return db.transaction(async (tx) => {
    const [organization] = await tx.insert(organizations).values({ ...input, createdBy: userId, currency: input.currency.toUpperCase(), isPersonal: options.isPersonal ?? false }).returning();
    if (!organization) throw new Error("Organization insert failed");
    await setTenantContext(tx, organization.id);
    await createDefaultVault(tx, organization.id, userId, organization.isPersonal);
    await tx.insert(organizationMembers).values({ organizationId: organization.id, userId, status: "active" });
    const createdRoles = await tx.insert(roles).values(BUILT_IN_ROLES.map((slug) => ({ organizationId: organization.id, name: slug.split("_").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" "), slug, isBuiltIn: true }))).returning();
    const permissionRows = await tx.select().from(permissions);
    for (const role of createdRoles) {
      const keys = rolePermissionsMap[role.slug as keyof typeof rolePermissionsMap] ?? [];
      const ids = permissionRows.filter((permission) => keys.includes(permission.key)).map((permission) => permission.id);
      if (ids.length) await tx.insert(rolePermissions).values(ids.map((permissionId) => ({ roleId: role.id, permissionId })));
    }
    const ownerRole = createdRoles.find((role) => role.slug === "super_admin");
    if (!ownerRole) throw new Error("Owner role missing");
    await tx.insert(userRoles).values({ organizationId: organization.id, userId, roleId: ownerRole.id });
    await tx.insert(categories).values([
      { organizationId: organization.id, name: "General", color: "#b8a4ed" }, { organizationId: organization.id, name: "Software", color: "#ff4d8b" },
      { organizationId: organization.id, name: "Travel", color: "#ffb084" }, { organizationId: organization.id, name: "Professional Services", color: "#e8b94a" },
    ]);
    await tx.insert(paymentMethods).values(["UPI", "NEFT", "RTGS", "IMPS", "Cash", "Card"].map((name) => ({ organizationId: organization.id, name, kind: name.toLowerCase() })));
    return { id: organization.id, name: organization.name, slug: organization.slug, currency: organization.currency, locale: organization.locale, timeZone: organization.timeZone, isPersonal: organization.isPersonal, role: "super_admin", permissions: [...PERMISSIONS] };
  });
}

export async function ensurePersonalOrganization(userId: string, displayName: string) {
  const db = getDatabase();
  const [existing] = await db.select({ id: organizations.id }).from(organizations).where(and(eq(organizations.createdBy, userId), eq(organizations.isPersonal, true))).limit(1);
  if (existing) return existing.id;
  const token = userId.replaceAll("-", "").slice(0, 16);
  const name = `${displayName.trim().slice(0, 70) || "My"} Personal Vault`;
  const organization = await createOrganization(userId, { name, slug: `personal-${token}`, currency: "USD", locale: "en-US", timeZone: "UTC" }, { isPersonal: true });
  return organization.id;
}

export async function listOrganizations(userId: string): Promise<Organization[]> {
  const db = getDatabase();
  const memberships = await db.select({ organization: organizations, roleId: userRoles.roleId, roleSlug: roles.slug }).from(organizationMembers).innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId)).leftJoin(userRoles, and(eq(userRoles.organizationId, organizations.id), eq(userRoles.userId, userId))).leftJoin(roles, eq(roles.id, userRoles.roleId)).where(and(eq(organizationMembers.userId, userId), eq(organizationMembers.status, "active")));
  const roleIds = memberships.flatMap((row) => row.roleId ? [row.roleId] : []);
  const permissionRows = roleIds.length ? await db.select({ roleId: rolePermissions.roleId, key: permissions.key }).from(rolePermissions).innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId)).where(inArray(rolePermissions.roleId, roleIds)) : [];
  /**
   * The order matters, because the first one is what the interface falls back
   * to when nothing has been chosen yet.
   *
   * The personal bucket is the fallback, so a real workspace comes first.
   * Without this the personal bucket was first for everyone, and everything
   * was saved there by default. The order is also fixed, so the default does
   * not change from one request to the next.
   */
  const ordered = [...memberships].sort((left, right) => {
    if (left.organization.isPersonal !== right.organization.isPersonal) return left.organization.isPersonal ? 1 : -1;
    return left.organization.createdAt.getTime() - right.organization.createdAt.getTime();
  });
  return ordered.map(({ organization, roleId, roleSlug }) => ({ id: organization.id, name: organization.name, slug: organization.slug, currency: organization.currency, locale: organization.locale, timeZone: organization.timeZone, isPersonal: organization.isPersonal, role: roleSlug ?? "viewer", permissions: permissionRows.filter((row) => row.roleId === roleId).map((row) => row.key) }));
}
