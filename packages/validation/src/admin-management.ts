import { z } from "zod";

const id = z.uuid();
const version = z.number().int().min(0).max(2147483646);
const slug = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const adminPermissionSchema = z.enum([
  "overview.view",
  "users.view",
  "users.edit",
  "users.manage",
  "users.approve",
  "users.history.view",
  "users.restrictions.view",
  "users.restrictions.manage",
  "users.restrictions.approve",
  "users.restrictions.notes.view",
  "games.view",
  "games.manage",
  "games.approve",
  "rooms.view",
  "rooms.manage",
  "rooms.approve",
  "rooms.players.view",
  "rooms.diagnostics.view",
  "matches.view",
  "matches.manage",
  "matches.approve",
  "matches.players.view",
  "matches.history.view",
  "matches.diagnostics.view",
  "monitoring.view",
  "audit.view",
  "admins.view",
  "admins.create",
  "admins.edit",
  "admins.manage",
  "roles.view",
  "roles.create",
  "roles.edit",
  "roles.manage",
]);
export const adminGrantSchema = z.strictObject({
  permission: adminPermissionSchema,
  environment: slug,
  gameIds: z
    .array(slug)
    .min(1)
    .max(32)
    .refine((a) => new Set(a).size === a.length)
    .nullable(),
  deny: z.boolean(),
});
export const adminGrantsSchema = z.array(adminGrantSchema).max(128);
export const adminActionSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    operation: z.literal("ADMIN_CREATE"),
    targetId: id,
    expectedVersion: z.literal(0),
    username: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,63}$/)
      .transform((v) => v.toLowerCase()),
  }),
  z.strictObject({
    operation: z.literal("ADMIN_STATUS"),
    targetId: id,
    expectedVersion: version,
    status: z.enum(["ACTIVE", "DISABLED", "DELETED"]),
  }),
  z.strictObject({
    operation: z.literal("ADMIN_RESET_PASSWORD"),
    targetId: id,
    expectedVersion: version,
  }),
  z.strictObject({
    operation: z.literal("ADMIN_ACCESS"),
    targetId: id,
    expectedVersion: version,
    roleIds: z
      .array(id)
      .max(16)
      .refine((a) => new Set(a).size === a.length),
    grants: adminGrantsSchema,
  }),
  z.strictObject({
    operation: z.literal("ADMIN_REVOKE_SESSIONS"),
    targetId: id,
    expectedVersion: version,
  }),
  z.strictObject({
    operation: z.literal("ROLE_SAVE"),
    expectedMemberCount: z.number().int().nonnegative().max(2147483647),
    targetId: id,
    expectedVersion: version,
    name: z
      .string()
      .trim()
      .min(2)
      .max(64)
      .refine((v) => !/owner|root/i.test(v)),
    grants: adminGrantsSchema,
  }),
  z.strictObject({
    operation: z.literal("ROLE_DELETE"),
    targetId: id,
    expectedVersion: version,
    expectedMemberCount: z.number().int().nonnegative().max(2147483647),
  }),
  z.strictObject({
    operation: z.literal("USER_DISPLAY_NAME"),
    targetId: id,
    expectedVersion: version,
    displayName: z.string().min(1).max(128),
  }),
  z.strictObject({
    operation: z.literal("USER_RESTRICT"),
    targetId: id,
    expectedVersion: version,
    duration: z.enum(["HOUR_1", "HOURS_24", "DAYS_7", "DAYS_30", "PERMANENT"]),
  }),
  z.strictObject({
    operation: z.literal("USER_UNRESTRICT"),
    targetId: id,
    expectedVersion: version,
    restrictionId: id.nullable(),
  }),
  z.strictObject({
    operation: z.literal("USER_STATUS"),
    targetId: id,
    expectedVersion: version,
    status: z.enum(["ACTIVE", "BANNED"]),
  }),
  z.strictObject({
    operation: z.literal("GAME_AVAILABILITY"),
    targetId: slug,
    expectedVersion: version,
    status: z.enum(["ACTIVE", "MAINTENANCE", "DISABLED"]),
  }),
  z.strictObject({ operation: z.literal("ROOM_CLOSE"), targetId: id, expectedVersion: version }),
  z.strictObject({
    operation: z.literal("MATCH_TERMINATE"),
    targetId: id,
    expectedVersion: version,
  }),
]);
export type AdminAction = z.infer<typeof adminActionSchema>;
export const adminCommandRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  commandId: id,
  action: adminActionSchema,
  privateNote: z.string().trim().min(1).max(2000).optional(),
  reasonCode: z.enum([
    "ACCESS_ADMINISTRATION",
    "SUPPORT_CORRECTION",
    "MAINTENANCE",
    "INCIDENT_RESPONSE",
    "ABUSE",
    "SPAM",
    "SECURITY",
    "APPEAL",
  ]),
});
export const adminApprovalSchema = z.strictObject({
  schemaVersion: z.literal(1),
  commandId: id,
  password: z.string().min(12).max(256),
  pin: z
    .string()
    .regex(/^[0-9]{6}$/)
    .optional(),
  confirmed: z.literal(true),
});
export const adminExecuteSchema = z.strictObject({ schemaVersion: z.literal(1), commandId: id });
export const adminCommandResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  commandId: id,
  operation: z.string(),
  targetId: z.string(),
  actorId: id,
  action: adminActionSchema,
  reasonCode: z.string(),
  digest: z.string().regex(/^[0-9a-f]{64}$/),
  state: z.enum(["PENDING", "APPROVED", "SUCCEEDED", "FAILED", "UNKNOWN"]),
  mode: z.enum(["OWNER_FINAL", "DUAL_CONTROL"]).nullable(),
  expiresAt: z.iso.datetime(),
  resultCode: z.string().nullable(),
  hasPrivateNote: z.boolean().optional(),
  // Only the first successful create/reset response may contain this field; never persisted.
  generatedPassword: z
    .string()
    .regex(/^(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9])[A-Za-z0-9]{12}$/)
    .optional(),
});
export const adminDirectorySchema = z.strictObject({
  schemaVersion: z.literal(1),
  environment: slug,
  policyRevision: version,
  operators: z
    .array(
      z.strictObject({
        id,
        username: z.string(),
        status: z.string(),
        isOwner: z.boolean(),
        version,
        roleIds: z.array(id),
        grants: adminGrantsSchema,
      }),
    )
    .max(50),
  roles: z
    .array(
      z.strictObject({
        id,
        name: z.string(),
        version,
        memberCount: z.number().int().nonnegative(),
        grants: adminGrantsSchema,
      }),
    )
    .max(100),
  nextCursor: id.nullable(),
});
export const adminSessionPageSchema = z.strictObject({
  schemaVersion: z.literal(1),
  items: z
    .array(
      z.strictObject({
        id,
        kind: z.enum(["PENDING", "FULL"]),
        issuedAt: z.iso.datetime(),
        expiresAt: z.iso.datetime(),
        lastSeenAt: z.iso.datetime(),
        valid: z.boolean(),
      }),
    )
    .max(50),
});
export const adminCommandPageSchema = z.strictObject({
  schemaVersion: z.literal(1),
  items: z.array(adminCommandResultSchema).max(50),
});
export const adminManagementMetaSchema = z.strictObject({
  schemaVersion: z.literal(1),
  restrictionsEnabled: z.boolean().optional(),
  permissions: z.array(adminPermissionSchema).max(100),
  templates: z.record(z.string(), z.array(adminPermissionSchema).max(100)),
  enabled: z.boolean(),
});
export const adminActivitySchema = z.strictObject({
  schemaVersion: z.literal(1),
  items: z
    .array(
      z.strictObject({
        id,
        operatorId: id.nullable(),
        commandId: id,
        event: z.string(),
        operation: z.string().nullable(),
        targetId: z.string().nullable(),
        reasonCode: z.string().nullable(),
        mode: z.string().nullable(),
        occurredAt: z.iso.datetime(),
      }),
    )
    .max(50),
});
