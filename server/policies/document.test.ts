import {
  CollectionPermission,
  UserRole,
} from "@shared/types";
import { Document, Permission } from "@server/models";
import {
  PermissionInheritMode,
  PermissionLevel,
  PermissionResourceType,
  PermissionSubjectType,
} from "@server/models/Permission";
import {
  buildUser,
  buildTeam,
  buildDocument,
  buildDraftDocument,
  buildCollection,
  buildAdmin,
  buildManager,
} from "@server/test/factories";
import { serialize } from "./index";

describe("read_write collection", () => {
  it("should allow read write permissions for member", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      permission: CollectionPermission.Edit,
    });
    const doc = await buildDocument({
      teamId: team.id,
      collectionId: collection.id,
    });
    // reload to get membership
    const document = await Document.findByPk(doc.id, { userId: user.id });
    const abilities = serialize(user, document);
    expect(abilities.read).toBeTruthy();
    expect(abilities.download).toBeTruthy();
    expect(abilities.update).toBeTruthy();
    expect(abilities.createChildDocument).toBeTruthy();
    expect(abilities.manageUsers).toEqual(false);
    expect(abilities.archive).toEqual(false);
    expect(abilities.delete).toEqual(false);
    expect(abilities.share).toEqual(false);
    expect(abilities.move).toBeTruthy();
    expect(abilities.comment).toBeTruthy();
  });

  it("should allow read permissions for viewer", async () => {
    const team = await buildTeam();
    const user = await buildUser({
      teamId: team.id,
      role: UserRole.Viewer,
    });
    const collection = await buildCollection({
      teamId: team.id,
      permission: CollectionPermission.Edit,
    });
    const doc = await buildDocument({
      teamId: team.id,
      collectionId: collection.id,
    });
    // reload to get membership
    const document = await Document.findByPk(doc.id, { userId: user.id });
    const abilities = serialize(user, document);
    expect(abilities.read).toBeTruthy();
    expect(abilities.download).toBeTruthy();
    expect(abilities.update).toEqual(false);
    expect(abilities.createChildDocument).toEqual(false);
    expect(abilities.manageUsers).toEqual(false);
    expect(abilities.archive).toEqual(false);
    expect(abilities.delete).toEqual(false);
    expect(abilities.share).toEqual(false);
    expect(abilities.move).toEqual(false);
    expect(abilities.subscribe).toBeTruthy();
    expect(abilities.unsubscribe).toBeTruthy();
    expect(abilities.comment).toBeTruthy();
  });

  it("should allow no permissions for guest", async () => {
    const team = await buildTeam();
    const user = await buildUser({
      teamId: team.id,
      role: UserRole.Viewer,
    });
    const collection = await buildCollection({
      teamId: team.id,
      permission: CollectionPermission.Edit,
    });
    const doc = await buildDocument({
      teamId: team.id,
      collectionId: collection.id,
    });
    // reload to get membership
    const document = await Document.findByPk(doc.id, { userId: user.id });
    const abilities = serialize(user, document);
    expect(abilities.read).toBeTruthy();
    expect(abilities.download).toBeTruthy();
    expect(abilities.update).toEqual(false);
    expect(abilities.createChildDocument).toEqual(false);
    expect(abilities.manageUsers).toEqual(false);
    expect(abilities.archive).toEqual(false);
    expect(abilities.delete).toEqual(false);
    expect(abilities.share).toEqual(false);
    expect(abilities.move).toEqual(false);
    expect(abilities.subscribe).toBeTruthy();
    expect(abilities.unsubscribe).toBeTruthy();
    expect(abilities.comment).toBeTruthy();
  });
});

describe("read collection", () => {
  it("should allow read permissions for team member", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      permission: CollectionPermission.Read,
    });
    const doc = await buildDocument({
      teamId: team.id,
      collectionId: collection.id,
    });
    // reload to get membership
    const document = await Document.findByPk(doc.id, { userId: user.id });
    const abilities = serialize(user, document);
    expect(abilities.read).toBeTruthy();
    expect(abilities.download).toBeTruthy();
    expect(abilities.update).toEqual(false);
    expect(abilities.createChildDocument).toEqual(false);
    expect(abilities.archive).toEqual(false);
    expect(abilities.delete).toEqual(false);
    expect(abilities.share).toEqual(false);
    expect(abilities.move).toEqual(false);
    expect(abilities.subscribe).toBeTruthy();
    expect(abilities.unsubscribe).toBeTruthy();
    expect(abilities.comment).toBeTruthy();
  });

  it("should allow no permissions for guest", async () => {
    const team = await buildTeam();
    const user = await buildUser({
      teamId: team.id,
      role: UserRole.Viewer,
    });
    const collection = await buildCollection({
      teamId: team.id,
      permission: CollectionPermission.Read,
    });
    const doc = await buildDocument({
      teamId: team.id,
      collectionId: collection.id,
    });
    // reload to get membership
    const document = await Document.findByPk(doc.id, { userId: user.id });
    const abilities = serialize(user, document);
    expect(abilities.read).toBeTruthy();
    expect(abilities.download).toBeTruthy();
    expect(abilities.update).toEqual(false);
    expect(abilities.createChildDocument).toEqual(false);
    expect(abilities.manageUsers).toEqual(false);
    expect(abilities.archive).toEqual(false);
    expect(abilities.delete).toEqual(false);
    expect(abilities.share).toEqual(false);
    expect(abilities.move).toEqual(false);
    expect(abilities.subscribe).toBeTruthy();
    expect(abilities.unsubscribe).toBeTruthy();
    expect(abilities.comment).toBeTruthy();
  });
});

describe("private collection", () => {
  it("should allow no permissions for team member", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      permission: null,
    });
    const document = await buildDocument({
      teamId: team.id,
      collectionId: collection.id,
    });
    const abilities = serialize(user, document);
    expect(abilities.read).toEqual(false);
    expect(abilities.download).toEqual(false);
    expect(abilities.update).toEqual(false);
    expect(abilities.createChildDocument).toEqual(false);
    expect(abilities.manageUsers).toEqual(false);
    expect(abilities.archive).toEqual(false);
    expect(abilities.delete).toEqual(false);
    expect(abilities.share).toEqual(false);
    expect(abilities.move).toEqual(false);
    expect(abilities.subscribe).toEqual(false);
    expect(abilities.unsubscribe).toEqual(false);
    expect(abilities.comment).toEqual(false);
  });

  it("should allow no permissions for guest", async () => {
    const team = await buildTeam();
    const user = await buildUser({
      teamId: team.id,
      role: UserRole.Viewer,
    });
    const collection = await buildCollection({
      teamId: team.id,
      permission: null,
    });
    const document = await buildDocument({
      teamId: team.id,
      collectionId: collection.id,
    });
    const abilities = serialize(user, document);
    expect(abilities.read).toEqual(false);
    expect(abilities.download).toEqual(false);
    expect(abilities.update).toEqual(false);
    expect(abilities.createChildDocument).toEqual(false);
    expect(abilities.manageUsers).toEqual(false);
    expect(abilities.archive).toEqual(false);
    expect(abilities.delete).toEqual(false);
    expect(abilities.share).toEqual(false);
    expect(abilities.move).toEqual(false);
    expect(abilities.subscribe).toEqual(false);
    expect(abilities.unsubscribe).toEqual(false);
    expect(abilities.comment).toEqual(false);
  });

  it("should allow read from explicit document permission grant", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      permission: null,
    });
    const doc = await buildDocument({
      teamId: team.id,
      collectionId: collection.id,
    });

    await Permission.create({
      teamId: team.id,
      subjectType: PermissionSubjectType.User,
      subjectId: user.id,
      subjectRole: null,
      resourceType: PermissionResourceType.Document,
      resourceId: doc.id,
      permission: PermissionLevel.Read,
      inheritMode: PermissionInheritMode.Self,
      grantedById: admin.id,
    });

    const document = await Document.findByPk(doc.id, { userId: user.id });
    const abilities = serialize(user, document);
    expect(abilities.read).toBeTruthy();
    expect(abilities.update).toEqual(false);
    expect(abilities.share).toEqual(false);
  });
});

describe("no collection", () => {
  it("should allow no permissions for team member", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const document = await buildDraftDocument({
      teamId: team.id,
    });
    const abilities = serialize(user, document);
    expect(abilities.read).toEqual(false);
    expect(abilities.download).toEqual(false);
    expect(abilities.update).toEqual(false);
    expect(abilities.createChildDocument).toEqual(false);
    expect(abilities.archive).toEqual(false);
    expect(abilities.delete).toEqual(false);
    expect(abilities.share).toEqual(false);
    expect(abilities.move).toEqual(false);
    expect(abilities.subscribe).toEqual(false);
    expect(abilities.unsubscribe).toEqual(false);
    expect(abilities.comment).toEqual(false);
  });

  it("should allow no permissions for guest", async () => {
    const team = await buildTeam();
    const user = await buildUser({
      teamId: team.id,
      role: UserRole.Viewer,
    });
    const document = await buildDraftDocument({
      teamId: team.id,
    });
    const abilities = serialize(user, document);
    expect(abilities.read).toEqual(false);
    expect(abilities.download).toEqual(false);
    expect(abilities.update).toEqual(false);
    expect(abilities.createChildDocument).toEqual(false);
    expect(abilities.archive).toEqual(false);
    expect(abilities.delete).toEqual(false);
    expect(abilities.share).toEqual(false);
    expect(abilities.move).toEqual(false);
    expect(abilities.subscribe).toEqual(false);
    expect(abilities.unsubscribe).toEqual(false);
    expect(abilities.comment).toEqual(false);
  });

  it("should allow edit permissions for creator", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const doc = await buildDraftDocument({
      teamId: team.id,
      userId: user.id,
    });
    // reload to get membership
    const document = await Document.findByPk(doc.id, { userId: user.id });
    const abilities = serialize(user, document);
    expect(abilities.read).toBeTruthy();
    expect(abilities.download).toBeTruthy();
    expect(abilities.update).toBeTruthy();
    expect(abilities.createChildDocument).toEqual(false);
    expect(abilities.archive).toEqual(false);
    expect(abilities.delete).toBeTruthy();
    expect(abilities.share).toBeTruthy();
    expect(abilities.move).toBeTruthy();
    expect(abilities.subscribe).toBeTruthy();
    expect(abilities.unsubscribe).toBeTruthy();
    expect(abilities.comment).toBeTruthy();
  });
});

describe("archived document", () => {
  it("should have correct permissions", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const doc = await buildDocument({
      teamId: team.id,
      userId: user.id,
      archivedAt: new Date(),
    });
    // reload to get membership
    const document = await Document.findByPk(doc.id, { userId: user.id });
    const abilities = serialize(user, document);
    expect(abilities.read).toBeTruthy();
    expect(abilities.download).toBeTruthy();
    expect(abilities.delete).toBeTruthy();
    expect(abilities.unsubscribe).toBeTruthy();
    expect(abilities.unarchive).toBeTruthy();
    expect(abilities.update).toEqual(false);
    expect(abilities.createChildDocument).toEqual(false);
    expect(abilities.manageUsers).toEqual(false);
    expect(abilities.archive).toEqual(false);
    expect(abilities.share).toEqual(false);
    expect(abilities.move).toEqual(false);
    expect(abilities.comment).toEqual(false);
  });
});

describe("read document", () => {
  for (const role of Object.values(UserRole)) {
    it(`should allow read permissions for ${role}`, async () => {
      const team = await buildTeam();
      const user = await buildUser({ teamId: team.id });
      const collection = await buildCollection({
        teamId: team.id,
        permission: null,
      });
      const doc = await buildDocument({
        teamId: team.id,
        collectionId: collection.id,
      });
      await Permission.create({
        teamId: team.id,
        subjectType: PermissionSubjectType.User,
        subjectId: user.id,
        subjectRole: null,
        resourceType: PermissionResourceType.Document,
        resourceId: doc.id,
        permission: PermissionLevel.Read,
        inheritMode: PermissionInheritMode.Children,
        grantedById: user.id,
      });

      // reload to get membership
      const document = await Document.findByPk(doc.id, { userId: user.id });
      const abilities = serialize(user, document);
      expect(abilities.read).toBeTruthy();
      expect(abilities.download).toBeTruthy();
      expect(abilities.subscribe).toBeTruthy();
      expect(abilities.unsubscribe).toBeTruthy();
      expect(abilities.comment).toBeTruthy();
      expect(abilities.update).toEqual(false);
      expect(abilities.createChildDocument).toEqual(false);
      expect(abilities.manageUsers).toEqual(false);
      expect(abilities.archive).toEqual(false);
      expect(abilities.delete).toEqual(false);
      expect(abilities.share).toEqual(false);
      expect(abilities.move).toEqual(false);
    });
  }
});

describe("read_write document", () => {
  const nonAdminRoles = Object.values(UserRole).filter(
    (role) => role !== UserRole.Admin
  );
  for (const role of nonAdminRoles) {
    it(`should allow write permissions for ${role}`, async () => {
      const team = await buildTeam();
      const user = await buildUser({ teamId: team.id, role });
      const collection = await buildCollection({
        teamId: team.id,
        permission: null,
      });
      const doc = await buildDocument({
        teamId: team.id,
        collectionId: collection.id,
      });
      await Permission.create({
        teamId: team.id,
        subjectType: PermissionSubjectType.User,
        subjectId: user.id,
        subjectRole: null,
        resourceType: PermissionResourceType.Document,
        resourceId: doc.id,
        permission: PermissionLevel.Edit,
        inheritMode: PermissionInheritMode.Children,
        grantedById: user.id,
      });

      // reload to get membership
      const document = await Document.findByPk(doc.id, { userId: user.id });
      const abilities = serialize(user, document);
      expect(abilities.read).toBeTruthy();
      expect(abilities.download).toBeTruthy();
      expect(abilities.update).toBeTruthy();
      expect(abilities.delete).toEqual(role === UserRole.Manager);
      expect(abilities.subscribe).toBeTruthy();
      expect(abilities.unsubscribe).toBeTruthy();
      expect(abilities.comment).toBeTruthy();
      expect(abilities.createChildDocument).toBeTruthy();
      expect(abilities.manageUsers).toEqual(role === UserRole.Manager);
      expect(abilities.archive).toEqual(role === UserRole.Manager);
      expect(abilities.share).toEqual(role === UserRole.Manager);
      expect(abilities.move).toBeTruthy();
    });
  }

  it(`should allow write permissions for admin`, async () => {
    const team = await buildTeam();
    const user = await buildAdmin({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      permission: null,
    });
    const doc = await buildDocument({
      teamId: team.id,
      collectionId: collection.id,
    });
    await Permission.create({
      teamId: team.id,
      subjectType: PermissionSubjectType.User,
      subjectId: user.id,
      subjectRole: null,
      resourceType: PermissionResourceType.Document,
      resourceId: doc.id,
      permission: PermissionLevel.Edit,
      inheritMode: PermissionInheritMode.Children,
      grantedById: user.id,
    });

    // reload to get membership
    const document = await Document.findByPk(doc.id, { userId: user.id });
    const abilities = serialize(user, document);
    expect(abilities.read).toBeTruthy();
    expect(abilities.download).toBeTruthy();
    expect(abilities.update).toBeTruthy();
    expect(abilities.delete).toBeTruthy();
    expect(abilities.subscribe).toBeTruthy();
    expect(abilities.unsubscribe).toBeTruthy();
    expect(abilities.comment).toBeTruthy();
    expect(abilities.createChildDocument).toBeTruthy();
    expect(abilities.manageUsers).toBeTruthy();
    expect(abilities.archive).toBeTruthy();
    expect(abilities.share).toBeTruthy();
    expect(abilities.move).toBeTruthy();
  });
});

describe("manage document", () => {
  for (const role of Object.values(UserRole)) {
    it(`should allow write permissions, user management, and sub-document creation for ${role}`, async () => {
      const team = await buildTeam();
      const user = await buildUser({
        teamId: team.id,
        role,
      });
      const collection = await buildCollection({
        teamId: team.id,
        permission: null,
      });
      const doc = await buildDocument({
        teamId: team.id,
        collectionId: collection.id,
      });
      await Permission.create({
        teamId: team.id,
        subjectType: PermissionSubjectType.User,
        subjectId: user.id,
        subjectRole: null,
        resourceType: PermissionResourceType.Document,
        resourceId: doc.id,
        permission: PermissionLevel.Manage,
        inheritMode: PermissionInheritMode.Children,
        grantedById: user.id,
      });

      // reload to get membership
      const document = await Document.findByPk(doc.id, { userId: user.id });
      const abilities = serialize(user, document);
      expect(abilities.read).toBeTruthy();
      expect(abilities.download).toBeTruthy();
      expect(abilities.update).toBeTruthy();
      expect(abilities.delete).toBeTruthy();
      expect(abilities.subscribe).toBeTruthy();
      expect(abilities.unsubscribe).toBeTruthy();
      expect(abilities.comment).toBeTruthy();
      expect(abilities.createChildDocument).toBeTruthy();
      expect(abilities.manageUsers).toBeTruthy();
      expect(abilities.archive).toBeTruthy();
      expect(abilities.move).toBeTruthy();
      expect(abilities.share).toEqual(role !== UserRole.Viewer);
    });
  }
});

describe("permanent delete", () => {
  it("should allow admin to permanently delete deleted documents", async () => {
    const team = await buildTeam();
    const admin = await buildAdmin({ teamId: team.id });
    const document = await buildDocument({ teamId: team.id, userId: admin.id });
    await document.destroy();

    const abilities = serialize(admin, document);
    expect(abilities.permanentDelete).toBeTruthy();
  });

  it("should not allow manager to permanently delete deleted documents", async () => {
    const team = await buildTeam();
    const manager = await buildManager({ teamId: team.id });
    const document = await buildDocument({
      teamId: team.id,
      userId: manager.id,
    });
    await document.destroy();

    const abilities = serialize(manager, document);
    expect(abilities.permanentDelete).toEqual(false);
  });
});
