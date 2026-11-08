-- Nino 2026-11-08: the warehouse person adds products to the system like the Director does.
-- Built-in roles are created once and the seed never re-grants existing permissions, so give this one to the WAREHOUSE role here (idempotent; nothing else changes).
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
  FROM "Role" r
  JOIN "Permission" p ON p."key" = 'products.create'
 WHERE r."key" = 'WAREHOUSE'
ON CONFLICT DO NOTHING;
