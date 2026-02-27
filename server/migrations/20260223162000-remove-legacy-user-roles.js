"use strict";

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE "users"
      SET "role" = CASE
        WHEN "role" = 'member' THEN 'editor'
        WHEN "role" = 'guest' THEN 'viewer'
        ELSE "role"
      END;
    `);

    await queryInterface.sequelize.query(`
      UPDATE "teams"
      SET "defaultUserRole" = CASE
        WHEN "defaultUserRole" = 'member' THEN 'editor'
        WHEN "defaultUserRole" = 'guest' THEN 'viewer'
        ELSE "defaultUserRole"
      END;
    `);

    await queryInterface.sequelize.query(`
      ALTER TYPE "enum_users_role" RENAME TO "enum_users_role_old";
    `);

    await queryInterface.sequelize.query(`
      CREATE TYPE "enum_users_role" AS ENUM ('admin', 'manager', 'editor', 'viewer');
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE "users"
      ALTER COLUMN "role" DROP DEFAULT,
      ALTER COLUMN "role" TYPE "enum_users_role"
      USING ("role"::text::"enum_users_role"),
      ALTER COLUMN "role" SET DEFAULT 'editor';
    `);

    await queryInterface.sequelize.query(`
      DROP TYPE "enum_users_role_old";
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TYPE "enum_users_role" RENAME TO "enum_users_role_new";
    `);

    await queryInterface.sequelize.query(`
      CREATE TYPE "enum_users_role" AS ENUM ('admin', 'member', 'viewer', 'guest');
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE "users"
      ALTER COLUMN "role" DROP DEFAULT,
      ALTER COLUMN "role" TYPE "enum_users_role"
      USING (
        CASE
          WHEN "role" = 'editor' THEN 'member'
          WHEN "role" = 'manager' THEN 'member'
          WHEN "role" = 'viewer' THEN 'guest'
          ELSE "role"::text
        END::"enum_users_role"
      ),
      ALTER COLUMN "role" SET DEFAULT 'member';
    `);

    await queryInterface.sequelize.query(`
      DROP TYPE "enum_users_role_new";
    `);

    await queryInterface.sequelize.query(`
      UPDATE "teams"
      SET "defaultUserRole" = CASE
        WHEN "defaultUserRole" = 'editor' THEN 'member'
        WHEN "defaultUserRole" = 'manager' THEN 'member'
        WHEN "defaultUserRole" = 'viewer' THEN 'guest'
        ELSE "defaultUserRole"
      END;
    `);
  },
};
