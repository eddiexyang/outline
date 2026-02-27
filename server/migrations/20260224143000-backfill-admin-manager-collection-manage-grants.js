"use strict";

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `INSERT INTO "permissions" (
           id, "teamId", "subjectType", "subjectId", "subjectRole",
           "resourceType", "resourceId", "permission", "inheritMode",
           "grantedById", "createdAt", "updatedAt", "deletedAt"
         )
         SELECT
           uuid_generate_v4(),
           c."teamId",
           'role',
           NULL,
           role_grants."subjectRole",
           'collection',
           c.id,
           'manage',
           'children',
           c."ownerId",
           NOW(),
           NOW(),
           NULL
         FROM "collections" c
         CROSS JOIN (
           VALUES ('admin'), ('manager')
         ) AS role_grants("subjectRole")
         WHERE c."deletedAt" IS NULL
           AND NOT EXISTS (
             SELECT 1
             FROM "permissions" p
             WHERE p."teamId" = c."teamId"
               AND p."subjectType" = 'role'
               AND p."subjectRole" = role_grants."subjectRole"
               AND p."resourceType" = 'collection'
               AND p."resourceId" = c.id
               AND p."inheritMode" = 'children'
               AND p."deletedAt" IS NULL
           );`,
        { transaction }
      );
    });
  },

  async down() {
    // no-op: this migration backfills missing grants and does not mark inserted rows.
    // Deleting by value-matching would also remove pre-existing valid grants.
  },
};
