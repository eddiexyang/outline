"use strict";

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_enum
          WHERE enumlabel = 'manager'
            AND enumtypid = 'enum_users_role'::regtype
        ) THEN
          ALTER TYPE "enum_users_role" ADD VALUE 'manager';
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM pg_enum
          WHERE enumlabel = 'editor'
            AND enumtypid = 'enum_users_role'::regtype
        ) THEN
          ALTER TYPE "enum_users_role" ADD VALUE 'editor';
        END IF;
      END
      $$;
    `);

    await queryInterface.sequelize.query(`
      UPDATE "users"
      SET "role" = 'editor'
      WHERE "role" = 'member';
    `);

    await queryInterface.sequelize.query(`
      UPDATE "users"
      SET "role" = 'viewer'
      WHERE "role" = 'guest';
    `);

    await queryInterface.sequelize.query(`
      UPDATE "teams"
      SET "defaultUserRole" = 'editor'
      WHERE "defaultUserRole" = 'member';
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE "users"
      SET "role" = CASE
        WHEN "role" = 'editor' THEN 'member'
        WHEN "role" = 'viewer' THEN 'guest'
        ELSE "role"
      END;
    `);

    await queryInterface.sequelize.query(`
      UPDATE "teams"
      SET "defaultUserRole" = CASE
        WHEN "defaultUserRole" = 'editor' THEN 'member'
        WHEN "defaultUserRole" = 'viewer' THEN 'guest'
        ELSE "defaultUserRole"
      END;
    `);
  },
};
