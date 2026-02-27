import type { Order, Transaction, WhereOptions } from "sequelize";
import { QueryTypes, Op } from "sequelize";
import { Document, Permission } from "@server/models";
import { PermissionInheritMode, PermissionResourceType } from "@server/models/Permission";

export type ResolvedPermission = {
  id: string;
  teamId: string;
  subjectType: string;
  subjectId: string | null;
  subjectRole: string | null;
  resourceType: string;
  resourceId: string | null;
  permission: string;
  inheritMode: string;
  grantedById: string;
  source: "direct" | "inherited";
};

const DEFAULT_ORDER: Order = [
  ["resourceType", "ASC"],
  ["subjectType", "ASC"],
  ["createdAt", "ASC"],
];

export default class PermissionResolver {
  static async resolveForCollection({
    teamId,
    collectionId,
    transaction,
  }: {
    teamId: string;
    collectionId: string;
    transaction?: Transaction;
  }): Promise<ResolvedPermission[]> {
    const permissions = await Permission.findAll({
      where: {
        teamId,
        deletedAt: null,
        [Op.or]: [
          {
            resourceType: PermissionResourceType.Collection,
            resourceId: collectionId,
          },
          {
            resourceType: PermissionResourceType.Workspace,
            resourceId: null,
            inheritMode: PermissionInheritMode.Children,
          },
        ],
      },
      order: DEFAULT_ORDER,
      transaction,
    });

    return permissions.map((permission) => ({
      id: permission.id,
      teamId: permission.teamId,
      subjectType: permission.subjectType,
      subjectId: permission.subjectId,
      subjectRole: permission.subjectRole,
      resourceType: permission.resourceType,
      resourceId: permission.resourceId,
      permission: permission.permission,
      inheritMode: permission.inheritMode,
      grantedById: permission.grantedById,
      source:
        permission.resourceType === PermissionResourceType.Collection &&
        permission.resourceId === collectionId
          ? "direct"
          : "inherited",
    }));
  }

  static async resolveForDocument({
    teamId,
    documentId,
    collectionId,
    transaction,
  }: {
    teamId: string;
    documentId: string;
    collectionId: string | null;
    transaction?: Transaction;
  }): Promise<ResolvedPermission[]> {
    const ancestorIds = await this.findAncestorDocumentIds(documentId, transaction);
    const inheritedAncestorIds = ancestorIds.filter((id) => id !== documentId);
    const disjunction: WhereOptions[] = [
      {
        resourceType: PermissionResourceType.Workspace,
        resourceId: null,
        inheritMode: PermissionInheritMode.Children,
      },
      {
        resourceType: PermissionResourceType.Document,
        resourceId: documentId,
      },
    ];

    if (collectionId) {
      disjunction.push({
        resourceType: PermissionResourceType.Collection,
        resourceId: collectionId,
        inheritMode: PermissionInheritMode.Children,
      });
    }

    if (inheritedAncestorIds.length) {
      disjunction.push({
        resourceType: PermissionResourceType.Document,
        resourceId: {
          [Op.in]: inheritedAncestorIds,
        },
        inheritMode: PermissionInheritMode.Children,
      });
    }

    const permissions = await Permission.findAll({
      where: {
        teamId,
        deletedAt: null,
        [Op.or]: disjunction,
      },
      order: DEFAULT_ORDER,
      transaction,
    });

    return permissions.map((permission) => ({
      id: permission.id,
      teamId: permission.teamId,
      subjectType: permission.subjectType,
      subjectId: permission.subjectId,
      subjectRole: permission.subjectRole,
      resourceType: permission.resourceType,
      resourceId: permission.resourceId,
      permission: permission.permission,
      inheritMode: permission.inheritMode,
      grantedById: permission.grantedById,
      source:
        permission.resourceType === PermissionResourceType.Document &&
        permission.resourceId === documentId
          ? "direct"
          : "inherited",
    }));
  }

  private static async findAncestorDocumentIds(
    documentId: string,
    transaction?: Transaction
  ): Promise<string[]> {
    if (!Document.sequelize) {
      return [documentId];
    }

    const rows = (await Document.sequelize.query(
      `
      WITH RECURSIVE ancestry AS (
        SELECT d.id, d."parentDocumentId"
        FROM documents d
        WHERE d.id = :documentId
        UNION ALL
        SELECT parent.id, parent."parentDocumentId"
        FROM documents parent
        INNER JOIN ancestry ON ancestry."parentDocumentId" = parent.id
      )
      SELECT id FROM ancestry
      `,
      {
        replacements: {
          documentId,
        },
        type: QueryTypes.SELECT,
        transaction,
      }
    )) as { id: string }[];

    return rows.map((row) => row.id);
  }
}
