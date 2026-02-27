import { faker } from "@faker-js/faker";
import { CollectionPermission, UserRole } from "@shared/types";
import { createContext } from "@server/context";
import { Event } from "@server/models";
import { sequelize } from "@server/storage/database";
import {
  buildUser,
  buildTeam,
  buildCollection,
  buildAdmin,
  buildManager,
  buildViewer,
} from "@server/test/factories";
import User from "./User";
import Permission, {
  PermissionInheritMode,
  PermissionLevel,
  PermissionResourceType,
  PermissionSubjectType,
} from "./Permission";

beforeAll(() => {
  jest.useFakeTimers().setSystemTime(new Date("2018-01-02T00:00:00.000Z"));
});

afterAll(() => {
  jest.useRealTimers();
});

describe("user model", () => {
  describe("createWithCtx", () => {
    it("should create an event with the new user as both actorId and userId", async () => {
      const team = await buildTeam();
      const email = faker.internet.email().toLowerCase();
      const name = faker.person.fullName();
      const ip = "127.0.0.1";

      const user = await sequelize.transaction(async (transaction) =>
        User.createWithCtx(createContext({ ip, transaction }), {
          email,
          name,
          teamId: team.id,
        })
      );

      const event = await Event.findOne({
        where: {
          name: "users.create",
          modelId: user.id,
        },
      });

      expect(event).toBeDefined();
      expect(event?.actorId).toEqual(user.id);
      expect(event?.userId).toEqual(user.id);
      expect(event?.teamId).toEqual(user.teamId);
      expect(event?.ip).toEqual(ip);
    });
  });

  describe("create", () => {
    it("should not allow URLs in name", async () => {
      await expect(
        buildUser({
          name: "www.google.com",
        })
      ).rejects.toThrow();

      await expect(
        buildUser({
          name: "My name https://malicious.com",
        })
      ).rejects.toThrow();

      await expect(
        buildUser({
          name: "wwwww",
        })
      ).resolves.toBeDefined();
    });
  });

  describe("destroy", () => {
    it("should clear PII", async () => {
      const user = await buildUser();

      await buildUser({
        teamId: user.teamId,
      });

      await user.destroy();
      expect(user.email).toBe(null);
      expect(user.name).toBe("Unknown");
    });

    it("should prevent last user from deleting account", async () => {
      const user = await buildUser();
      let error;

      try {
        await user.destroy();
      } catch (err) {
        error = err;
      }

      expect(error && error.message).toContain("Cannot delete last user");
    });

    it("should prevent last admin from deleting account", async () => {
      const user = await buildAdmin();
      await buildUser({
        teamId: user.teamId,
      });
      let error;

      try {
        await user.destroy();
      } catch (err) {
        error = err;
      }

      expect(error && error.message).toContain("Cannot delete account");
    });

    it("should not prevent multiple admin from deleting account", async () => {
      const actor = await buildAdmin();
      const user = await buildAdmin({
        teamId: actor.teamId,
      });
      let error;

      try {
        await user.destroy();
      } catch (err) {
        error = err;
      }

      expect(error).toBeFalsy();
      expect(user.deletedAt).toBeTruthy();
    });

    it("should not prevent last non-admin from deleting account", async () => {
      const user = await buildUser();
      await buildUser({
        teamId: user.teamId,
      });
      let error;

      try {
        await user.destroy();
      } catch (err) {
        error = err;
      }

      expect(error).toBeFalsy();
      expect(user.deletedAt).toBeTruthy();
    });
  });

  describe("getJwtToken", () => {
    it("should set JWT secret", async () => {
      const user = await buildUser();
      expect(user.getJwtToken()).toBeTruthy();
    });
  });

  describe("availableTeams", () => {
    it("should return teams where another user with the same email exists", async () => {
      const email = faker.internet.email().toLowerCase();
      const user = await buildUser({
        email,
      });
      const anotherUser = await buildUser({ email });

      const response = await user.availableTeams();
      const teamIds = response.map((t) => t.id).sort();
      const expectedTeamIds = [user.teamId, anotherUser.teamId].sort();
      expect(teamIds).toEqual(expectedTeamIds);
    });
  });

  describe("collectionIds", () => {
    it("should return read_write collections", async () => {
      const team = await buildTeam();
      const user = await buildUser({
        teamId: team.id,
      });
      const collection = await buildCollection({
        teamId: team.id,
        permission: CollectionPermission.Edit,
      });
      const response = await user.collectionIds();
      expect(response.length).toEqual(1);
      expect(response[0]).toEqual(collection.id);
    });

    it("should return read collections", async () => {
      const team = await buildTeam();
      const user = await buildUser({
        teamId: team.id,
      });
      const collection = await buildCollection({
        teamId: team.id,
        permission: CollectionPermission.Read,
      });
      const response = await user.collectionIds();
      expect(response.length).toEqual(1);
      expect(response[0]).toEqual(collection.id);
    });

    it("should not return private collections", async () => {
      const team = await buildTeam();
      const user = await buildUser({
        teamId: team.id,
      });
      await buildCollection({
        teamId: team.id,
        permission: null,
      });
      const response = await user.collectionIds();
      expect(response.length).toEqual(0);
    });

    it("should not return private collection without explicit permission grant", async () => {
      const team = await buildTeam();
      const user = await buildUser({
        teamId: team.id,
      });
      await buildCollection({
        teamId: team.id,
        permission: null,
      });
      const response = await user.collectionIds();
      expect(response.length).toEqual(0);
    });

    it("should include private collection with explicit permission grant", async () => {
      const team = await buildTeam();
      const user = await buildUser({
        teamId: team.id,
      });
      const collection = await buildCollection({
        teamId: team.id,
        permission: null,
      });

      await Permission.create({
        teamId: team.id,
        subjectType: PermissionSubjectType.User,
        subjectId: user.id,
        subjectRole: null,
        resourceType: PermissionResourceType.Collection,
        resourceId: collection.id,
        permission: PermissionLevel.Read,
        inheritMode: PermissionInheritMode.Children,
        grantedById: user.id,
      });

      const response = await user.collectionIds();
      expect(response).toContain(collection.id);
    });

    it("should include all collections with workspace children grant", async () => {
      const team = await buildTeam();
      const user = await buildUser({
        teamId: team.id,
      });
      const [collectionA, collectionB] = await Promise.all([
        buildCollection({
          teamId: team.id,
          permission: null,
        }),
        buildCollection({
          teamId: team.id,
          permission: CollectionPermission.Read,
        }),
      ]);

      await Permission.create({
        teamId: team.id,
        subjectType: PermissionSubjectType.User,
        subjectId: user.id,
        subjectRole: null,
        resourceType: PermissionResourceType.Workspace,
        resourceId: null,
        permission: PermissionLevel.Read,
        inheritMode: PermissionInheritMode.Children,
        grantedById: user.id,
      });

      const response = await user.collectionIds();
      expect(response).toEqual(
        expect.arrayContaining([collectionA.id, collectionB.id])
      );
    });
  });

  describe("updatePermissionGrants", () => {
    it("should downgrade permissions when demoting Admin to Viewer", async () => {
      const admin = await buildAdmin();
      // Ensure there's another admin so we can demote this one
      await buildAdmin({ teamId: admin.teamId });
      const collection = await buildCollection({
        teamId: admin.teamId,
        permission: null,
      });
      await Permission.create({
        teamId: admin.teamId,
        subjectType: PermissionSubjectType.User,
        subjectId: admin.id,
        subjectRole: null,
        resourceType: PermissionResourceType.Collection,
        resourceId: collection.id,
        permission: PermissionLevel.Edit,
        inheritMode: PermissionInheritMode.Children,
        grantedById: admin.id,
      });

      await sequelize.transaction(async (transaction) => {
        await admin.update({ role: UserRole.Viewer }, { transaction });
      });

      const grant = await Permission.findOne({
        where: {
          teamId: admin.teamId,
          subjectType: PermissionSubjectType.User,
          subjectId: admin.id,
          resourceType: PermissionResourceType.Collection,
          resourceId: collection.id,
        },
      });
      expect(grant?.permission).toEqual(PermissionLevel.Read);
    });

    it("should downgrade permissions when demoting Manager to Viewer", async () => {
      const admin = await buildManager();
      const collection = await buildCollection({
        teamId: admin.teamId,
        permission: null,
      });
      await Permission.create({
        teamId: admin.teamId,
        subjectType: PermissionSubjectType.User,
        subjectId: admin.id,
        subjectRole: null,
        resourceType: PermissionResourceType.Collection,
        resourceId: collection.id,
        permission: PermissionLevel.Edit,
        inheritMode: PermissionInheritMode.Children,
        grantedById: admin.id,
      });

      await sequelize.transaction(async (transaction) => {
        await admin.update({ role: UserRole.Viewer }, { transaction });
      });

      const grant = await Permission.findOne({
        where: {
          teamId: admin.teamId,
          subjectType: PermissionSubjectType.User,
          subjectId: admin.id,
          resourceType: PermissionResourceType.Collection,
          resourceId: collection.id,
        },
      });
      expect(grant?.permission).toEqual(PermissionLevel.Read);
    });

    it("should downgrade permissions when demoting Member to Viewer", async () => {
      const user = await buildUser();
      const collection = await buildCollection({
        teamId: user.teamId,
        permission: null,
      });
      await Permission.create({
        teamId: user.teamId,
        subjectType: PermissionSubjectType.User,
        subjectId: user.id,
        subjectRole: null,
        resourceType: PermissionResourceType.Collection,
        resourceId: collection.id,
        permission: PermissionLevel.Edit,
        inheritMode: PermissionInheritMode.Children,
        grantedById: user.id,
      });

      await sequelize.transaction(async (transaction) => {
        await user.update({ role: UserRole.Viewer }, { transaction });
      });

      const grant = await Permission.findOne({
        where: {
          teamId: user.teamId,
          subjectType: PermissionSubjectType.User,
          subjectId: user.id,
          resourceType: PermissionResourceType.Collection,
          resourceId: collection.id,
        },
      });
      expect(grant?.permission).toEqual(PermissionLevel.Read);
    });

    it("should downgrade permissions when demoting Editor to Viewer", async () => {
      const user = await buildUser();
      const collection = await buildCollection({
        teamId: user.teamId,
        permission: null,
      });
      await Permission.create({
        teamId: user.teamId,
        subjectType: PermissionSubjectType.User,
        subjectId: user.id,
        subjectRole: null,
        resourceType: PermissionResourceType.Collection,
        resourceId: collection.id,
        permission: PermissionLevel.Manage,
        inheritMode: PermissionInheritMode.Children,
        grantedById: user.id,
      });

      await sequelize.transaction(async (transaction) => {
        await user.update({ role: UserRole.Viewer }, { transaction });
      });

      const grant = await Permission.findOne({
        where: {
          teamId: user.teamId,
          subjectType: PermissionSubjectType.User,
          subjectId: user.id,
          resourceType: PermissionResourceType.Collection,
          resourceId: collection.id,
        },
      });
      expect(grant?.permission).toEqual(PermissionLevel.Read);
    });

    it("should not downgrade permissions when role does not change", async () => {
      const viewer = await buildViewer();
      const collection = await buildCollection({
        teamId: viewer.teamId,
        permission: null,
      });
      await Permission.create({
        teamId: viewer.teamId,
        subjectType: PermissionSubjectType.User,
        subjectId: viewer.id,
        subjectRole: null,
        resourceType: PermissionResourceType.Collection,
        resourceId: collection.id,
        permission: PermissionLevel.Edit,
        inheritMode: PermissionInheritMode.Children,
        grantedById: viewer.id,
      });

      await sequelize.transaction(async (transaction) => {
        await viewer.update({ role: UserRole.Viewer }, { transaction });
      });

      const grant = await Permission.findOne({
        where: {
          teamId: viewer.teamId,
          subjectType: PermissionSubjectType.User,
          subjectId: viewer.id,
          resourceType: PermissionResourceType.Collection,
          resourceId: collection.id,
        },
      });
      expect(grant?.permission).toEqual(PermissionLevel.Edit);
    });

    it("should not downgrade permissions when promoting Viewer to Editor", async () => {
      const guest = await buildViewer();
      const collection = await buildCollection({
        teamId: guest.teamId,
        permission: null,
      });
      await Permission.create({
        teamId: guest.teamId,
        subjectType: PermissionSubjectType.User,
        subjectId: guest.id,
        subjectRole: null,
        resourceType: PermissionResourceType.Collection,
        resourceId: collection.id,
        permission: PermissionLevel.Edit,
        inheritMode: PermissionInheritMode.Children,
        grantedById: guest.id,
      });

      await sequelize.transaction(async (transaction) => {
        await guest.update({ role: UserRole.Editor }, { transaction });
      });

      const grant = await Permission.findOne({
        where: {
          teamId: guest.teamId,
          subjectType: PermissionSubjectType.User,
          subjectId: guest.id,
          resourceType: PermissionResourceType.Collection,
          resourceId: collection.id,
        },
      });
      expect(grant?.permission).toEqual(PermissionLevel.Edit);
    });

    it("should not downgrade permissions when promoting Viewer to Member", async () => {
      const viewer = await buildViewer();
      const collection = await buildCollection({
        teamId: viewer.teamId,
        permission: null,
      });
      await Permission.create({
        teamId: viewer.teamId,
        subjectType: PermissionSubjectType.User,
        subjectId: viewer.id,
        subjectRole: null,
        resourceType: PermissionResourceType.Collection,
        resourceId: collection.id,
        permission: PermissionLevel.Read,
        inheritMode: PermissionInheritMode.Children,
        grantedById: viewer.id,
      });

      await sequelize.transaction(async (transaction) => {
        await viewer.update({ role: UserRole.Editor }, { transaction });
      });

      const grant = await Permission.findOne({
        where: {
          teamId: viewer.teamId,
          subjectType: PermissionSubjectType.User,
          subjectId: viewer.id,
          resourceType: PermissionResourceType.Collection,
          resourceId: collection.id,
        },
      });
      expect(grant?.permission).toEqual(PermissionLevel.Read);
    });

    it("should not downgrade permissions when demoting Admin to Member", async () => {
      const admin = await buildAdmin();
      // Ensure there's another admin so we can demote this one
      await buildAdmin({ teamId: admin.teamId });
      const collection = await buildCollection({
        teamId: admin.teamId,
        permission: null,
      });
      await Permission.create({
        teamId: admin.teamId,
        subjectType: PermissionSubjectType.User,
        subjectId: admin.id,
        subjectRole: null,
        resourceType: PermissionResourceType.Collection,
        resourceId: collection.id,
        permission: PermissionLevel.Edit,
        inheritMode: PermissionInheritMode.Children,
        grantedById: admin.id,
      });

      await sequelize.transaction(async (transaction) => {
        await admin.update({ role: UserRole.Editor }, { transaction });
      });

      const grant = await Permission.findOne({
        where: {
          teamId: admin.teamId,
          subjectType: PermissionSubjectType.User,
          subjectId: admin.id,
          resourceType: PermissionResourceType.Collection,
          resourceId: collection.id,
        },
      });
      expect(grant?.permission).toEqual(PermissionLevel.Edit);
    });
  });
});
