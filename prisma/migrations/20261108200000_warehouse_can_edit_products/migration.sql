-- Nino 2026-11-08: the warehouse person opens a product to change its details and picture, and can delete a product that has no stock.
-- Built-in roles are created once and the seed never re-grants existing permissions, so give these two to the WAREHOUSE role here (idempotent; nothing else changes).
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
  FROM "Role" r
  JOIN "Permission" p ON p."key" IN ('products.edit', 'products.deactivate')
 WHERE r."key" = 'WAREHOUSE'
ON CONFLICT DO NOTHING;
