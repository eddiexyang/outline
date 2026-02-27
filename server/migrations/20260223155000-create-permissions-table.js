"use strict";

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`,
        { transaction }
      );

      await queryInterface.createTable(
        "permissions",
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            defaultValue: Sequelize.literal("uuid_generate_v4()"),
            primaryKey: true,
          },
          teamId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: "teams",
              key: "id",
            },
            onDelete: "cascade",
          },
          subjectType: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          subjectId: {
            type: Sequelize.UUID,
            allowNull: true,
          },
          subjectRole: {
            type: Sequelize.STRING,
            allowNull: true,
          },
          resourceType: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          resourceId: {
            type: Sequelize.UUID,
            allowNull: true,
          },
          permission: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          inheritMode: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          grantedById: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: "users",
              key: "id",
            },
            onDelete: "cascade",
          },
          createdAt: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal("NOW()"),
          },
          updatedAt: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.literal("NOW()"),
          },
          deletedAt: {
            type: Sequelize.DATE,
            allowNull: true,
          },
        },
        { transaction }
      );

      await queryInterface.sequelize.query(
        `ALTER TABLE "permissions"
         ADD CONSTRAINT "permissions_subject_type_check"
         CHECK ("subjectType" IN ('user', 'group', 'role'));`,
        { transaction }
      );
      await queryInterface.sequelize.query(
        `ALTER TABLE "permissions"
         ADD CONSTRAINT "permissions_resource_type_check"
         CHECK ("resourceType" IN ('workspace', 'collection', 'document'));`,
        { transaction }
      );
      await queryInterface.sequelize.query(
        `ALTER TABLE "permissions"
         ADD CONSTRAINT "permissions_permission_check"
         CHECK ("permission" IN ('read', 'edit', 'manage'));`,
        { transaction }
      );
      await queryInterface.sequelize.query(
        `ALTER TABLE "permissions"
         ADD CONSTRAINT "permissions_inherit_mode_check"
         CHECK ("inheritMode" IN ('self', 'children'));`,
        { transaction }
      );
      await queryInterface.sequelize.query(
        `ALTER TABLE "permissions"
         ADD CONSTRAINT "permissions_subject_consistency_check"
         CHECK (
           ("subjectType" = 'role' AND "subjectRole" IS NOT NULL AND "subjectId" IS NULL)
           OR
           ("subjectType" IN ('user', 'group') AND "subjectId" IS NOT NULL AND "subjectRole" IS NULL)
         );`,
        { transaction }
      );
      await queryInterface.sequelize.query(
        `ALTER TABLE "permissions"
         ADD CONSTRAINT "permissions_resource_consistency_check"
         CHECK (
           ("resourceType" = 'workspace' AND "resourceId" IS NULL)
           OR
           ("resourceType" IN ('collection', 'document') AND "resourceId" IS NOT NULL)
         );`,
        { transaction }
      );

      await queryInterface.addColumn(
        "collections",
        "ownerId",
        {
          type: Sequelize.UUID,
          allowNull: true,
          references: {
            model: "users",
            key: "id",
          },
          onDelete: "set null",
        },
        { transaction }
      );

      await queryInterface.sequelize.query(
        `UPDATE "collections" c
         SET "ownerId" = c."createdById"
         WHERE c."ownerId" IS NULL
           AND c."createdById" IS NOT NULL;`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `UPDATE "collections" c
         SET "ownerId" = owners."userId"
         FROM (
           SELECT DISTINCT ON (up."collectionId")
             up."collectionId",
             up."userId"
           FROM "user_permissions" up
           WHERE up."collectionId" IS NOT NULL
             AND up."permission" = 'admin'
           ORDER BY up."collectionId", up."createdAt" ASC
         ) owners
         WHERE c.id = owners."collectionId"
           AND c."ownerId" IS NULL;`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `UPDATE "collections" c
         SET "ownerId" = admins.id
         FROM (
           SELECT DISTINCT ON (u."teamId")
             u."teamId",
             u.id
           FROM "users" u
           WHERE u.role = 'admin'
           ORDER BY u."teamId", u."createdAt" ASC
         ) admins
         WHERE c."teamId" = admins."teamId"
           AND c."ownerId" IS NULL;`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `UPDATE "collections" c
         SET "ownerId" = fallback.id
         FROM (
           SELECT DISTINCT ON (u."teamId")
             u."teamId",
             u.id
           FROM "users" u
           ORDER BY u."teamId", u."createdAt" ASC
         ) fallback
         WHERE c."teamId" = fallback."teamId"
           AND c."ownerId" IS NULL;`,
        { transaction }
      );

      await queryInterface.changeColumn(
        "collections",
        "ownerId",
        {
          type: Sequelize.UUID,
          allowNull: false,
          references: {
            model: "users",
            key: "id",
          },
          onDelete: "restrict",
        },
        { transaction }
      );

      await queryInterface.addIndex("collections", ["ownerId"], { transaction });

      await queryInterface.sequelize.query(
        `INSERT INTO "permissions" (
           id, "teamId", "subjectType", "subjectId", "subjectRole",
           "resourceType", "resourceId", "permission", "inheritMode",
           "grantedById", "createdAt", "updatedAt", "deletedAt"
         )
         SELECT
           uuid_generate_v4(),
           c."teamId",
           'user',
           c."ownerId",
           NULL,
           'collection',
           c.id,
           'manage',
           'children',
           c."ownerId",
           NOW(),
           NOW(),
           NULL
         FROM "collections" c;`,
        { transaction }
      );

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
           CASE
             WHEN c."permission" = 'read' THEN 'viewer'
             WHEN c."permission" = 'read_write' THEN 'editor'
             ELSE NULL
           END,
           'collection',
           c.id,
           CASE
             WHEN c."permission" = 'read' THEN 'read'
             WHEN c."permission" = 'read_write' THEN 'edit'
             ELSE NULL
           END,
           'children',
           c."ownerId",
           NOW(),
           NOW(),
           NULL
         FROM "collections" c
         WHERE c."permission" IN ('read', 'read_write');`,
        { transaction }
      );

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
           'editor',
           'collection',
           c.id,
           'read',
           'children',
           c."ownerId",
           NOW(),
           NOW(),
           NULL
         FROM "collections" c
         WHERE c."permission" = 'read';`,
        { transaction }
      );

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
           'viewer',
           'collection',
           c.id,
           'read',
           'children',
           c."ownerId",
           NOW(),
           NOW(),
           NULL
         FROM "collections" c
         WHERE c."permission" = 'read_write';`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `INSERT INTO "permissions" (
           id, "teamId", "subjectType", "subjectId", "subjectRole",
           "resourceType", "resourceId", "permission", "inheritMode",
           "grantedById", "createdAt", "updatedAt", "deletedAt"
         )
         SELECT
           uuid_generate_v4(),
           c."teamId",
           'user',
           up."userId",
           NULL,
           'collection',
           up."collectionId",
           CASE
             WHEN up."permission" = 'admin' THEN 'manage'
             WHEN up."permission" = 'read_write' THEN 'edit'
             ELSE 'read'
           END,
           'children',
           COALESCE(up."createdById", c."ownerId"),
           up."createdAt",
           up."updatedAt",
           NULL
         FROM "user_permissions" up
         JOIN "collections" c ON c.id = up."collectionId"
         WHERE up."collectionId" IS NOT NULL
           AND up."sourceId" IS NULL;`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `INSERT INTO "permissions" (
           id, "teamId", "subjectType", "subjectId", "subjectRole",
           "resourceType", "resourceId", "permission", "inheritMode",
           "grantedById", "createdAt", "updatedAt", "deletedAt"
         )
         SELECT
           uuid_generate_v4(),
           d."teamId",
           'user',
           up."userId",
           NULL,
           'document',
           up."documentId",
           CASE
             WHEN up."permission" = 'admin' THEN 'manage'
             WHEN up."permission" = 'read_write' THEN 'edit'
             ELSE 'read'
           END,
           'self',
           COALESCE(up."createdById", d."createdById"),
           up."createdAt",
           up."updatedAt",
           NULL
         FROM "user_permissions" up
         JOIN "documents" d ON d.id = up."documentId"
         WHERE up."documentId" IS NOT NULL;`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `INSERT INTO "permissions" (
           id, "teamId", "subjectType", "subjectId", "subjectRole",
           "resourceType", "resourceId", "permission", "inheritMode",
           "grantedById", "createdAt", "updatedAt", "deletedAt"
         )
         SELECT
           uuid_generate_v4(),
           c."teamId",
           'group',
           gp."groupId",
           NULL,
           'collection',
           gp."collectionId",
           CASE
             WHEN gp."permission" = 'admin' THEN 'manage'
             WHEN gp."permission" = 'read_write' THEN 'edit'
             ELSE 'read'
           END,
           'children',
           COALESCE(gp."createdById", c."ownerId"),
           gp."createdAt",
           gp."updatedAt",
           NULL
         FROM "group_permissions" gp
         JOIN "collections" c ON c.id = gp."collectionId"
         WHERE gp."collectionId" IS NOT NULL
           AND gp."sourceId" IS NULL
           AND gp."deletedAt" IS NULL;`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `INSERT INTO "permissions" (
           id, "teamId", "subjectType", "subjectId", "subjectRole",
           "resourceType", "resourceId", "permission", "inheritMode",
           "grantedById", "createdAt", "updatedAt", "deletedAt"
         )
         SELECT
           uuid_generate_v4(),
           d."teamId",
           'group',
           gp."groupId",
           NULL,
           'document',
           gp."documentId",
           CASE
             WHEN gp."permission" = 'admin' THEN 'manage'
             WHEN gp."permission" = 'read_write' THEN 'edit'
             ELSE 'read'
           END,
           'self',
           COALESCE(gp."createdById", d."createdById"),
           gp."createdAt",
           gp."updatedAt",
           NULL
         FROM "group_permissions" gp
         JOIN "documents" d ON d.id = gp."documentId"
         WHERE gp."documentId" IS NOT NULL
           AND gp."deletedAt" IS NULL;`,
        { transaction }
      );

      await queryInterface.sequelize.query(
        `DELETE FROM "permissions" p
         USING (
           SELECT id
           FROM (
             SELECT
               id,
               ROW_NUMBER() OVER (
                 PARTITION BY
                   "teamId",
                   "subjectType",
                   COALESCE("subjectId", '${ZERO_UUID}'::uuid),
                   COALESCE("subjectRole", ''),
                   "resourceType",
                   COALESCE("resourceId", '${ZERO_UUID}'::uuid),
                   "inheritMode"
                 ORDER BY
                   CASE "permission"
                     WHEN 'manage' THEN 3
                     WHEN 'edit' THEN 2
                     ELSE 1
                   END DESC,
                   "createdAt" ASC
               ) AS rownum
             FROM "permissions"
             WHERE "deletedAt" IS NULL
           ) ranked
           WHERE ranked.rownum > 1
         ) duplicates
         WHERE p.id = duplicates.id;`,
        { transaction }
      );

      await queryInterface.addIndex(
        "permissions",
        ["teamId", "subjectType", "subjectId"],
        { name: "permissions_team_subject_idx", transaction }
      );
      await queryInterface.addIndex(
        "permissions",
        ["teamId", "subjectType", "subjectRole"],
        { name: "permissions_team_role_subject_idx", transaction }
      );
      await queryInterface.addIndex(
        "permissions",
        ["teamId", "resourceType", "resourceId"],
        { name: "permissions_team_resource_idx", transaction }
      );
      await queryInterface.addIndex(
        "permissions",
        ["teamId", "permission"],
        { name: "permissions_team_permission_idx", transaction }
      );
      await queryInterface.addIndex("permissions", ["deletedAt"], {
        name: "permissions_deleted_at_idx",
        transaction,
      });

      await queryInterface.sequelize.query(
        `CREATE UNIQUE INDEX "permissions_unique_active_idx"
         ON "permissions" (
           "teamId",
           "subjectType",
           COALESCE("subjectId", '${ZERO_UUID}'::uuid),
           COALESCE("subjectRole", ''),
           "resourceType",
           COALESCE("resourceId", '${ZERO_UUID}'::uuid),
           "inheritMode"
         )
         WHERE "deletedAt" IS NULL;`,
        { transaction }
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeIndex("collections", ["ownerId"], {
        transaction,
      });
      await queryInterface.removeColumn("collections", "ownerId", {
        transaction,
      });
      await queryInterface.dropTable("permissions", { transaction });
    });
  },
};
