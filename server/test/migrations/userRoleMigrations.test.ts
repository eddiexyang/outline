describe("user role migrations", () => {
  it("20260223154000 down maps viewer back to guest for users and teams", async () => {
    const migration = require("../../migrations/20260223154000-update-user-roles.js");
    const queries: string[] = [];
    const query = jest.fn(async (sql: string) => {
      queries.push(sql);
    });
    const queryInterface = { sequelize: { query } };

    await migration.down(queryInterface);

    const sql = queries.join("\n");
    expect(sql).toContain(`WHEN "role" = 'viewer' THEN 'guest'`);
    expect(sql).toContain(`WHEN "defaultUserRole" = 'viewer' THEN 'guest'`);
  });

  it("20260223162000 down maps viewer back to guest for users and teams", async () => {
    const migration = require("../../migrations/20260223162000-remove-legacy-user-roles.js");
    const queries: string[] = [];
    const query = jest.fn(async (sql: string) => {
      queries.push(sql);
    });
    const queryInterface = { sequelize: { query } };

    await migration.down(queryInterface);

    const sql = queries.join("\n");
    expect(sql).toContain(`WHEN "role" = 'viewer' THEN 'guest'`);
    expect(sql).toContain(`WHEN "defaultUserRole" = 'viewer' THEN 'guest'`);
  });

  it("20260224143000 down is non-destructive", async () => {
    const migration = require("../../migrations/20260224143000-backfill-admin-manager-collection-manage-grants.js");
    const query = jest.fn();
    const queryInterface = { sequelize: { query } };

    await migration.down(queryInterface);

    expect(query).not.toHaveBeenCalled();
  });
});
