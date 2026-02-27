import { CollectionPermission, UserRole } from "@shared/types";
import { Collection, Permission } from "@server/models";
import {
  PermissionInheritMode,
  PermissionLevel,
  PermissionResourceType,
  PermissionSubjectType,
} from "@server/models/Permission";
import {
  buildUser,
  buildTeam,
  buildCollection,
  buildAdmin,
  buildManager,
} from "@server/test/factories";
import { serialize } from "./index";

describe("admin", () => {
  it("should allow updating collection and reading documents", async () => {
    const team = await buildTeam();
    const user = await buildAdmin({
      teamId: team.id,
    });
    const collection = await buildCollection({
      teamId: team.id,
      permission: null,
    });
    // reload to get membership
    const reloaded = await Collection.findByPk(collection.id, {
      userId: user.id,
    });
    const abilities = serialize(user, reloaded);
    expect(abilities.readDocument).toBeTruthy();
    expect(abilities.updateDocument).toBeTruthy();
    expect(abilities.createDocument).toBeTruthy();
    expect(abilities.share).toBeTruthy();
    expect(abilities.read).toBeTruthy();
    expect(abilities.update).toBeTruthy();
    expect(abilities.archive).toBeTruthy();
  });

  it("should have correct permissions in view only collection", async () => {
    const team = await buildTeam();
    const user = await buildAdmin({
      teamId: team.id,
    });
    const collection = await buildCollection({
      teamId: team.id,
      permission: CollectionPermission.Read,
    });
    // reload to get membership
    const reloaded = await Collection.findByPk(collection.id, {
      userId: user.id,
    });
    const abilities = serialize(user, reloaded);
    expect(abilities.readDocument).toBeTruthy();
    expect(abilities.share).toBeTruthy();
    expect(abilities.read).toBeTruthy();
    expect(abilities.update).toBeTruthy();
    expect(abilities.archive).toBeTruthy();

    expect(abilities.updateDocument).toBeTruthy();
    expect(abilities.createDocument).toBeTruthy();
  });
});

describe("manager", () => {
  it("should allow full collection management but not depend on membership", async () => {
    const team = await buildTeam();
    const user = await buildManager({
      teamId: team.id,
    });
    const collection = await buildCollection({
      teamId: team.id,
      permission: null,
    });
    const reloaded = await Collection.findByPk(collection.id, {
      userId: user.id,
    });
    const abilities = serialize(user, reloaded);
    expect(abilities.read).toBeTruthy();
    expect(abilities.readDocument).toBeTruthy();
    expect(abilities.updateDocument).toBeTruthy();
    expect(abilities.createDocument).toBeTruthy();
    expect(abilities.deleteDocument).toBeTruthy();
    expect(abilities.update).toBeTruthy();
    expect(abilities.archive).toBeTruthy();
  });
});

describe("editor", () => {
  describe("admin permission", () => {
    it("should allow member to update collection", async () => {
      const team = await buildTeam();
      const admin = await buildAdmin({ teamId: team.id });
      const member = await buildUser({ teamId: team.id });
      const collection = await buildCollection({ teamId: team.id });
      await Permission.create({
        teamId: team.id,
        subjectType: PermissionSubjectType.User,
        subjectId: member.id,
        subjectRole: null,
        resourceType: PermissionResourceType.Collection,
        resourceId: collection.id,
        permission: PermissionLevel.Manage,
        inheritMode: PermissionInheritMode.Children,
        grantedById: admin.id,
      });
      // reload to get membership
      const reloaded = await Collection.findByPk(collection.id, {
        userId: member.id,
      });
      const abilities = serialize(member, reloaded);
      expect(abilities.read).toBeTruthy();
      expect(abilities.update).toBeTruthy();
      expect(abilities.readDocument).toBeTruthy();
      expect(abilities.updateDocument).toBeTruthy();
      expect(abilities.createDocument).toBeTruthy();
      expect(abilities.share).toBeTruthy();
      expect(abilities.update).toBeTruthy();
      expect(abilities.archive).toBeTruthy();
    });
  });

  describe("read_write permission", () => {
    it("should disallow member to update collection", async () => {
      const team = await buildTeam();
      const admin = await buildAdmin({ teamId: team.id });
      const member = await buildUser({ teamId: team.id });

      const collection = await buildCollection({ teamId: team.id });
      await Permission.create({
        teamId: team.id,
        subjectType: PermissionSubjectType.User,
        subjectId: member.id,
        subjectRole: null,
        resourceType: PermissionResourceType.Collection,
        resourceId: collection.id,
        permission: PermissionLevel.Edit,
        inheritMode: PermissionInheritMode.Children,
        grantedById: admin.id,
      });
      // reload to get membership
      const reloaded = await Collection.findByPk(collection.id, {
        userId: member.id,
      });
      const abilities = serialize(member, reloaded);
      expect(abilities.read).toBeTruthy();
      expect(abilities.update).toBe(false);
      expect(abilities.readDocument).toBeTruthy();
      expect(abilities.updateDocument).toBeTruthy();
      expect(abilities.createDocument).toBeTruthy();
      expect(abilities.archive).toBe(false);
    });

    it("should allow read write documents for team member", async () => {
      const team = await buildTeam();
      const user = await buildUser({
        teamId: team.id,
      });
      const collection = await buildCollection({
        teamId: team.id,
        permission: CollectionPermission.Edit,
      });
      const reloaded = await Collection.findByPk(collection.id, {
        userId: user.id,
      });
      const abilities = serialize(user, reloaded);
      expect(abilities.read).toBeTruthy();
      expect(abilities.readDocument).toBeTruthy();
      expect(abilities.share).toEqual(false);
      expect(abilities.update).toEqual(false);
      expect(abilities.archive).toEqual(false);
    });

    it("should override read membership permission", async () => {
      const team = await buildTeam();
      const user = await buildUser({
        teamId: team.id,
      });
      const collection = await buildCollection({
        teamId: team.id,
        permission: CollectionPermission.Edit,
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
      // reload to get membership
      const reloaded = await Collection.findByPk(collection.id, {
        userId: user.id,
      });
      const abilities = serialize(user, reloaded);
      expect(abilities.read).toBeTruthy();
      expect(abilities.readDocument).toBeTruthy();
      expect(abilities.share).toEqual(false);
      expect(abilities.update).toEqual(false);
      expect(abilities.archive).toEqual(false);
    });
  });

  describe("read permission", () => {
    it("should disallow member to archive collection", async () => {
      const team = await buildTeam();
      const admin = await buildAdmin({ teamId: team.id });
      const member = await buildUser({ teamId: team.id });
      const collection = await buildCollection({
        teamId: team.id,
        permission: CollectionPermission.Read,
      });
      await Permission.create({
        teamId: team.id,
        subjectType: PermissionSubjectType.User,
        subjectId: member.id,
        subjectRole: null,
        resourceType: PermissionResourceType.Collection,
        resourceId: collection.id,
        permission: PermissionLevel.Read,
        inheritMode: PermissionInheritMode.Children,
        grantedById: admin.id,
      });
      // reload to get membership
      const reloaded = await Collection.findByPk(collection.id, {
        userId: member.id,
      });
      const abilities = serialize(member, reloaded);
      expect(abilities.read).toBeTruthy();
      expect(abilities.update).not.toBeTruthy();
      expect(abilities.readDocument).toBeTruthy();
      expect(abilities.updateDocument).toBe(false);
      expect(abilities.createDocument).toBe(false);
      expect(abilities.archive).toBe(false);
    });

    it("should allow read permissions for team member", async () => {
      const team = await buildTeam();
      const user = await buildUser({
        teamId: team.id,
      });
      const collection = await buildCollection({
        teamId: team.id,
        permission: CollectionPermission.Read,
      });
      const reloaded = await Collection.findByPk(collection.id, {
        userId: user.id,
      });
      const abilities = serialize(user, reloaded);
      expect(abilities.read).toBeTruthy();
      expect(abilities.update).toEqual(false);
      expect(abilities.share).toEqual(false);
      expect(abilities.archive).toEqual(false);
    });

    it("should not allow sharing with edit membership override", async () => {
      const team = await buildTeam();
      const admin = await buildAdmin({ teamId: team.id });
      const member = await buildUser({ teamId: team.id });
      const collection = await buildCollection({
        teamId: team.id,
        permission: CollectionPermission.Read,
      });
      await Permission.create({
        teamId: team.id,
        subjectType: PermissionSubjectType.User,
        subjectId: member.id,
        subjectRole: null,
        resourceType: PermissionResourceType.Collection,
        resourceId: collection.id,
        permission: PermissionLevel.Edit,
        inheritMode: PermissionInheritMode.Children,
        grantedById: admin.id,
      });
      // reload to get membership
      const reloaded = await Collection.findByPk(collection.id, {
        userId: member.id,
      });
      const abilities = serialize(member, reloaded);
      expect(abilities.read).toBeTruthy();
      expect(abilities.readDocument).toBeTruthy();
      expect(abilities.share).toEqual(false);
      expect(abilities.update).toEqual(false);
      expect(abilities.archive).toEqual(false);
    });
  });

  describe("no permission", () => {
    it("should allow no permissions for team member", async () => {
      const team = await buildTeam();
      const user = await buildUser({
        teamId: team.id,
      });
      const collection = await buildCollection({
        teamId: team.id,
        permission: null,
      });
      const abilities = serialize(user, collection);
      expect(abilities.read).toEqual(false);
      expect(abilities.readDocument).toEqual(false);
      expect(abilities.createDocument).toEqual(false);
      expect(abilities.share).toEqual(false);
      expect(abilities.update).toEqual(false);
      expect(abilities.archive).toEqual(false);
    });

    it("should allow override with team member membership permission", async () => {
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
        permission: PermissionLevel.Edit,
        inheritMode: PermissionInheritMode.Children,
        grantedById: user.id,
      });
      // reload to get membership
      const reloaded = await Collection.findByPk(collection.id, {
        userId: user.id,
      });
      const abilities = serialize(user, reloaded);
      expect(abilities.read).toBeTruthy();
      expect(abilities.readDocument).toBeTruthy();
      expect(abilities.createDocument).toBeTruthy();
      expect(abilities.share).toEqual(false);
      expect(abilities.update).toEqual(false);
      expect(abilities.archive).toEqual(false);
    });

    it("should allow read for explicit permission grant without membership", async () => {
      const team = await buildTeam();
      const admin = await buildAdmin({ teamId: team.id });
      const user = await buildUser({ teamId: team.id });
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
        grantedById: admin.id,
      });

      const reloaded = await Collection.findByPk(collection.id, {
        userId: user.id,
      });
      const abilities = serialize(user, reloaded);
      expect(abilities.read).toBeTruthy();
      expect(abilities.readDocument).toBeTruthy();
      expect(abilities.createDocument).toEqual(false);
    });
  });
});

describe("viewer", () => {
  describe("read_write permission", () => {
    it("should allow read permissions for viewer", async () => {
      const team = await buildTeam();
      const user = await buildUser({
        role: UserRole.Viewer,
        teamId: team.id,
      });
      const collection = await buildCollection({
        teamId: team.id,
        permission: CollectionPermission.Edit,
      });
      const reloaded = await Collection.findByPk(collection.id, {
        userId: user.id,
      });
      const abilities = serialize(user, reloaded);
      expect(abilities.read).toBeTruthy();
      expect(abilities.readDocument).toBeTruthy();
      expect(abilities.createDocument).toEqual(false);
      expect(abilities.update).toEqual(false);
      expect(abilities.share).toEqual(false);
      expect(abilities.archive).toEqual(false);
    });

    it("should override read membership permission", async () => {
      const team = await buildTeam();
      const user = await buildUser({
        role: UserRole.Viewer,
        teamId: team.id,
      });
      const collection = await buildCollection({
        teamId: team.id,
        permission: CollectionPermission.Edit,
      });
      await Permission.create({
        teamId: team.id,
        subjectType: PermissionSubjectType.User,
        subjectId: user.id,
        subjectRole: null,
        resourceType: PermissionResourceType.Collection,
        resourceId: collection.id,
        permission: PermissionLevel.Edit,
        inheritMode: PermissionInheritMode.Children,
        grantedById: user.id,
      });
      // reload to get membership
      const reloaded = await Collection.findByPk(collection.id, {
        userId: user.id,
      });
      const abilities = serialize(user, reloaded);
      expect(abilities.read).toBeTruthy();
      expect(abilities.readDocument).toBeTruthy();
      expect(abilities.share).toEqual(false);
      expect(abilities.update).toEqual(false);
      expect(abilities.archive).toEqual(false);
    });
  });

  describe("read permission", () => {
    it("should allow override with read_write membership permission", async () => {
      const team = await buildTeam();
      const user = await buildUser({
        role: UserRole.Viewer,
        teamId: team.id,
      });
      const collection = await buildCollection({
        teamId: team.id,
        permission: CollectionPermission.Read,
      });
      await Permission.create({
        teamId: team.id,
        subjectType: PermissionSubjectType.User,
        subjectId: user.id,
        subjectRole: null,
        resourceType: PermissionResourceType.Collection,
        resourceId: collection.id,
        permission: PermissionLevel.Edit,
        inheritMode: PermissionInheritMode.Children,
        grantedById: user.id,
      });
      // reload to get membership
      const reloaded = await Collection.findByPk(collection.id, {
        userId: user.id,
      });
      const abilities = serialize(user, reloaded);
      expect(abilities.read).toBeTruthy();
      expect(abilities.readDocument).toBeTruthy();
      expect(abilities.createDocument).toBeTruthy();
      expect(abilities.share).toEqual(false);
      expect(abilities.update).toEqual(false);
      expect(abilities.archive).toEqual(false);
    });
  });

  describe("no permission", () => {
    it("should allow no permissions for viewer", async () => {
      const team = await buildTeam();
      const user = await buildUser({
        role: UserRole.Viewer,
        teamId: team.id,
      });
      const collection = await buildCollection({
        teamId: team.id,
        permission: null,
      });
      const abilities = serialize(user, collection);
      expect(abilities.read).toEqual(false);
      expect(abilities.update).toEqual(false);
      expect(abilities.share).toEqual(false);
      expect(abilities.archive).toEqual(false);
    });

    it("should allow override with team member membership permission", async () => {
      const team = await buildTeam();
      const user = await buildUser({
        role: UserRole.Viewer,
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
        permission: PermissionLevel.Edit,
        inheritMode: PermissionInheritMode.Children,
        grantedById: user.id,
      });
      // reload to get membership
      const reloaded = await Collection.findByPk(collection.id, {
        userId: user.id,
      });
      const abilities = serialize(user, reloaded);
      expect(abilities.read).toBeTruthy();
      expect(abilities.readDocument).toBeTruthy();
      expect(abilities.createDocument).toBeTruthy();
      expect(abilities.share).toEqual(false);
      expect(abilities.update).toEqual(false);
      expect(abilities.archive).toEqual(false);
    });
  });
});
