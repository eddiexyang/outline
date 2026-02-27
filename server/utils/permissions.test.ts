import { CollectionPermission, DocumentPermission, UserRole } from "@shared/types";
import { Permission } from "@server/models";
import {
  PermissionInheritMode,
  PermissionLevel,
  PermissionResourceType,
  PermissionSubjectType,
} from "@server/models/Permission";
import {
  buildCollection,
  buildDocument,
  buildGroup,
  buildGroupUser,
  buildUser,
} from "@server/test/factories";
import { getDocumentPermission, isElevatedPermission } from "./permissions";

const toPermissionLevel = (
  permission: CollectionPermission | DocumentPermission
) =>
  permission === CollectionPermission.Manage ||
  permission === DocumentPermission.Manage
    ? PermissionLevel.Manage
    : permission === CollectionPermission.Edit ||
        permission === DocumentPermission.Edit
      ? PermissionLevel.Edit
      : PermissionLevel.Read;

const grantUserPermission = async ({
  teamId,
  createdById,
  userId,
  collectionId,
  documentId,
  permission,
}: {
  teamId: string;
  createdById: string;
  userId: string;
  collectionId?: string;
  documentId?: string;
  permission: CollectionPermission | DocumentPermission;
}) =>
  Permission.create({
    teamId,
    subjectType: PermissionSubjectType.User,
    subjectId: userId,
    subjectRole: null,
    resourceType: collectionId
      ? PermissionResourceType.Collection
      : PermissionResourceType.Document,
    resourceId: collectionId ?? documentId ?? null,
    permission: toPermissionLevel(permission),
    inheritMode: collectionId
      ? PermissionInheritMode.Children
      : PermissionInheritMode.Self,
    grantedById: createdById,
  });

const grantGroupPermission = async ({
  teamId,
  createdById,
  groupId,
  documentId,
  permission,
}: {
  teamId: string;
  createdById: string;
  groupId: string;
  documentId: string;
  permission: DocumentPermission;
}) =>
  Permission.create({
    teamId,
    subjectType: PermissionSubjectType.Group,
    subjectId: groupId,
    subjectRole: null,
    resourceType: PermissionResourceType.Document,
    resourceId: documentId,
    permission: toPermissionLevel(permission),
    inheritMode: PermissionInheritMode.Self,
    grantedById: createdById,
  });

describe("permissions", () => {
  describe("isElevatedPermission", () => {
    it("should return false when user has higher permission through collection", async () => {
      const user = await buildUser();
      const collection = await buildCollection({
        teamId: user.teamId,
        permission: null,
      });
      const document = await buildDocument({
        collectionId: collection.id,
        teamId: user.teamId,
      });
      await grantUserPermission({
        teamId: user.teamId,
        createdById: user.id,
        collectionId: collection.id,
        userId: user.id,
        permission: CollectionPermission.Edit,
      });

      const isElevated = await isElevatedPermission({
        userId: user.id,
        documentId: document.id,
        permission: DocumentPermission.Read,
      });

      expect(isElevated).toBe(false);
    });

    it("should return false when user has higher permission through document", async () => {
      const user = await buildUser();
      const collection = await buildCollection({
        teamId: user.teamId,
        permission: null,
      });
      const document = await buildDocument({
        collectionId: collection.id,
        teamId: user.teamId,
      });
      const group = await buildGroup();
      await Promise.all([
        await buildGroupUser({
          groupId: group.id,
          userId: user.id,
          teamId: user.teamId,
        }),
        await grantUserPermission({
          teamId: user.teamId,
          createdById: user.id,
          documentId: document.id,
          userId: user.id,
          permission: DocumentPermission.Read,
        }),
        await grantGroupPermission({
          teamId: user.teamId,
          createdById: user.id,
          documentId: document.id,
          groupId: group.id,
          permission: DocumentPermission.Edit,
        }),
      ]);

      const isElevated = await isElevatedPermission({
        userId: user.id,
        documentId: document.id,
        permission: DocumentPermission.Read,
      });

      expect(isElevated).toBe(false);
    });

    it("should return false when user has the same permission", async () => {
      const user = await buildUser();
      const collection = await buildCollection({
        teamId: user.teamId,
        permission: null,
      });
      const document = await buildDocument({
        collectionId: collection.id,
        teamId: user.teamId,
      });
      const group = await buildGroup();
      await Promise.all([
        await buildGroupUser({
          groupId: group.id,
          userId: user.id,
          teamId: user.teamId,
        }),
        await grantUserPermission({
          teamId: user.teamId,
          createdById: user.id,
          documentId: document.id,
          userId: user.id,
          permission: DocumentPermission.Read,
        }),
        await grantGroupPermission({
          teamId: user.teamId,
          createdById: user.id,
          documentId: document.id,
          groupId: group.id,
          permission: DocumentPermission.Edit,
        }),
      ]);

      const isElevated = await isElevatedPermission({
        userId: user.id,
        documentId: document.id,
        permission: DocumentPermission.Edit,
      });

      expect(isElevated).toBe(false);
    });

    it("should return true when user has lower permission", async () => {
      const user = await buildUser();
      const collection = await buildCollection({
        teamId: user.teamId,
        permission: null,
      });
      const document = await buildDocument({
        collectionId: collection.id,
        teamId: user.teamId,
      });
      const group = await buildGroup();
      await Promise.all([
        await buildGroupUser({
          groupId: group.id,
          userId: user.id,
          teamId: user.teamId,
        }),
        await grantUserPermission({
          teamId: user.teamId,
          createdById: user.id,
          documentId: document.id,
          userId: user.id,
          permission: DocumentPermission.Read,
        }),
        await grantGroupPermission({
          teamId: user.teamId,
          createdById: user.id,
          documentId: document.id,
          groupId: group.id,
          permission: DocumentPermission.Edit,
        }),
      ]);

      const isElevated = await isElevatedPermission({
        userId: user.id,
        documentId: document.id,
        permission: DocumentPermission.Manage,
      });

      expect(isElevated).toBe(true);
    });

    it("should return true when user does not have access", async () => {
      const user = await buildUser();
      const collection = await buildCollection({
        teamId: user.teamId,
        permission: null,
      });
      const document = await buildDocument({
        collectionId: collection.id,
        teamId: user.teamId,
      });

      const isElevated = await isElevatedPermission({
        userId: user.id,
        documentId: document.id,
        permission: DocumentPermission.Manage,
      });

      expect(isElevated).toBe(true);
    });
  });

  describe("getDocumentPermission", () => {
    it("should return the highest provided permission through collection", async () => {
      const user = await buildUser();
      const collection = await buildCollection({
        teamId: user.teamId,
        permission: null,
      });
      const document = await buildDocument({
        collectionId: collection.id,
        teamId: user.teamId,
      });
      await grantUserPermission({
        teamId: user.teamId,
        createdById: user.id,
        collectionId: collection.id,
        userId: user.id,
        permission: CollectionPermission.Edit,
      });

      const permission = await getDocumentPermission({
        userId: user.id,
        documentId: document.id,
      });

      expect(permission).toEqual(DocumentPermission.Edit);
    });

    it("should return the highest provided permission through document", async () => {
      const user = await buildUser();
      const collection = await buildCollection({
        teamId: user.teamId,
        permission: null,
      });
      const document = await buildDocument({
        collectionId: collection.id,
        teamId: user.teamId,
      });
      const group = await buildGroup();
      await Promise.all([
        await buildGroupUser({
          groupId: group.id,
          userId: user.id,
          teamId: user.teamId,
        }),
        await grantUserPermission({
          teamId: user.teamId,
          createdById: user.id,
          documentId: document.id,
          userId: user.id,
          permission: DocumentPermission.Read,
        }),
        await grantGroupPermission({
          teamId: user.teamId,
          createdById: user.id,
          documentId: document.id,
          groupId: group.id,
          permission: DocumentPermission.Edit,
        }),
      ]);

      const permission = await getDocumentPermission({
        userId: user.id,
        documentId: document.id,
      });

      expect(permission).toEqual(DocumentPermission.Edit);
    });

    it("should return the highest provided permission with skipped membership", async () => {
      const owner = await buildUser();
      const user = await buildUser({
        teamId: owner.teamId,
        role: UserRole.Viewer,
      });
      const collection = await buildCollection({
        userId: owner.id,
        teamId: owner.teamId,
        permission: null,
      });
      const document = await buildDocument({
        userId: owner.id,
        collectionId: collection.id,
        teamId: owner.teamId,
      });
      const group = await buildGroup();
      const [, userPermission, groupPermission] = await Promise.all([
        await buildGroupUser({
          groupId: group.id,
          userId: user.id,
          teamId: user.teamId,
        }),
        await Permission.create({
          teamId: owner.teamId,
          subjectType: PermissionSubjectType.User,
          subjectId: user.id,
          subjectRole: null,
          resourceType: PermissionResourceType.Document,
          resourceId: document.id,
          permission: PermissionLevel.Read,
          inheritMode: PermissionInheritMode.Self,
          grantedById: owner.id,
        }),
        await Permission.create({
          teamId: owner.teamId,
          subjectType: PermissionSubjectType.Group,
          subjectId: group.id,
          subjectRole: null,
          resourceType: PermissionResourceType.Document,
          resourceId: document.id,
          permission: PermissionLevel.Edit,
          inheritMode: PermissionInheritMode.Self,
          grantedById: owner.id,
        }),
      ]);

      const permission = await getDocumentPermission({
        userId: user.id,
        documentId: document.id,
        skipMembershipId: groupPermission.id,
      });

      expect(permission).toEqual(DocumentPermission.Read);

      const fullPermission = await getDocumentPermission({
        userId: user.id,
        documentId: document.id,
        skipMembershipId: userPermission.id,
      });

      expect(fullPermission).toEqual(DocumentPermission.Edit);
    });

    it("should return undefined when user does not have access", async () => {
      const user = await buildUser();
      const collection = await buildCollection({
        teamId: user.teamId,
        permission: null,
      });
      const document = await buildDocument({
        collectionId: collection.id,
        teamId: user.teamId,
      });

      const permission = await getDocumentPermission({
        userId: user.id,
        documentId: document.id,
      });

      expect(permission).toBeUndefined();
    });
  });
});
