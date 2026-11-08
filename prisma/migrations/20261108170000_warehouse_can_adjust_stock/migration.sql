-- Nino 2026-11-08: the warehouse person adds stock that came without a purchase order and removes stock, from a product, always with a note.
-- Built-in roles are created once and the seed never re-grants existing permissions, so give this one to the WAREHOUSE role here (idempotent; nothing else changes).
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
  FROM "Role" r
  JOIN "Permission" p ON p."key" = 'inventory.adjust'
 WHERE r."key" = 'WAREHOUSE'
ON CONFLICT DO NOTHING;
