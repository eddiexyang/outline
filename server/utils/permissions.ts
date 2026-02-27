import orderBy from "lodash/orderBy";
import { CollectionPermission, DocumentPermission } from "@shared/types";
import type { User } from "@server/models";
import {
  Document,
  Group,
  User as UserModel,
} from "@server/models";
import {
  PermissionLevel,
  PermissionSubjectType,
} from "@server/models/Permission";
import PermissionResolver from "@server/services/permissions/PermissionResolver";
import { authorize } from "@server/policies";

// Higher value takes precedence
export const CollectionPermissionPriority = {
  [CollectionPermission.Manage]: 2,
  [CollectionPermission.Edit]: 1,
  [CollectionPermission.Read]: 0,
} satisfies Record<CollectionPermission, number>;

// Higher value takes precedence
export const DocumentPermissionPriority = {
  [DocumentPermission.Manage]: 2,
  [DocumentPermission.Edit]: 1,
  [DocumentPermission.Read]: 0,
} satisfies Record<DocumentPermission, number>;

/**
 * Check if the given user can access a document
 *
 * @param user - The user to check
 * @param documentId - The document to check
 * @returns Boolean whether the user can access the document
 */
export const canUserAccessDocument = async (user: User, documentId: string) => {
  try {
    const document = await Document.findByPk(documentId, {
      userId: user.id,
    });
    authorize(user, "read", document);
    return true;
  } catch (_err) {
    return false;
  }
};

/**
 * Determines whether the user's access to a document is being elevated with the new permission.
 *
 * @param {Object} params Input parameters.
 * @param {string} params.userId The user to check.
 * @param {string} params.documentId The document to check.
 * @param {DocumentPermission} params.permission The new permission given to the user.
 * @param {string} params.skipMembershipId The membership to skip when comparing the existing permissions.
 * @returns {boolean} Whether the user has a higher access level
 */
export const isElevatedPermission = async ({
  userId,
  documentId,
  permission,
  skipMembershipId,
}: {
  userId: string;
  documentId: string;
  permission: DocumentPermission;
  skipMembershipId?: string;
}) => {
  const existingPermission = await getDocumentPermission({
    userId,
    documentId,
    skipMembershipId,
  });

  if (!existingPermission) {
    return true;
  }

  return (
    DocumentPermissionPriority[existingPermission] <
    DocumentPermissionPriority[permission]
  );
};

/**
 * Returns the user's permission to a document.
 *
 * @param {Object} params Input parameters.
 * @param {string} params.userId The user to check.
 * @param {string} params.documentId The document to check.
 * @param {string} params.skipMembershipId The membership to skip when comparing the existing permissions.
 * @returns {DocumentPermission | undefined} Highest permission, if it exists.
 */
export const getDocumentPermission = async ({
  userId,
  documentId,
  skipMembershipId,
}: {
  userId: string;
  documentId: string;
  skipMembershipId?: string;
}): Promise<DocumentPermission | undefined> => {
  const [document, user, groups] = await Promise.all([
    Document.findByPk(documentId),
    UserModel.findByPk(userId),
    Group.filterByMember(userId).findAll({
      attributes: ["id"],
    }),
  ]);
  if (!document || !user) {
    return undefined;
  }

  const groupIds = new Set(groups.map((group) => group.id));
  const resolvedPermissions = await PermissionResolver.resolveForDocument({
    teamId: user.teamId,
    documentId: document.id,
    collectionId: document.collectionId ?? null,
  });

  const permissions = resolvedPermissions
    .filter((permission) => permission.id !== skipMembershipId)
    .filter((permission) => {
      if (permission.subjectType === PermissionSubjectType.User) {
        return permission.subjectId === userId;
      }
      if (permission.subjectType === PermissionSubjectType.Role) {
        return permission.subjectRole === user.role;
      }
      if (permission.subjectType === PermissionSubjectType.Group) {
        return !!permission.subjectId && groupIds.has(permission.subjectId);
      }
      return false;
    })
    .map((permission) => {
      if (permission.permission === PermissionLevel.Manage) {
        return DocumentPermission.Manage;
      }
      if (permission.permission === PermissionLevel.Edit) {
        return DocumentPermission.Edit;
      }
      return DocumentPermission.Read;
    });

  const orderedPermissions = orderBy(
    permissions,
    (permission) => DocumentPermissionPriority[permission],
    "desc"
  );

  return orderedPermissions[0];
};
