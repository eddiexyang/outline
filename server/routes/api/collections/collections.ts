import Router from "koa-router";
import type { WhereOptions } from "sequelize";
import { Sequelize, Op } from "sequelize";
import {
  CollectionPermission,
  CollectionStatusFilter,
  FileOperationState,
  FileOperationType,
  UserRole,
} from "@shared/types";
import collectionExporter from "@server/commands/collectionExporter";
import teamUpdater from "@server/commands/teamUpdater";
import { parser } from "@server/editor";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import { transaction } from "@server/middlewares/transaction";
import validate from "@server/middlewares/validate";
import {
  Collection,
  Team,
  User,
  Group,
  Permission,
  Attachment,
  FileOperation,
  Document,
  Share,
} from "@server/models";
import {
  PermissionInheritMode,
  PermissionLevel,
  PermissionResourceType,
  PermissionSubjectType,
} from "@server/models/Permission";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";
import { authorize } from "@server/policies";
import {
  presentCollection,
  presentUser,
  presentPolicies,
  presentGroup,
  presentFileOperation,
} from "@server/presenters";
import type { APIContext } from "@server/types";
import { CacheHelper } from "@server/utils/CacheHelper";
import { RedisPrefixHelper } from "@server/utils/RedisPrefixHelper";
import { RateLimiterStrategy } from "@server/utils/RateLimiter";
import { collectionIndexing } from "@server/utils/indexing";
import PermissionResolver from "@server/services/permissions/PermissionResolver";
import pagination from "../middlewares/pagination";
import * as T from "./schema";
import { InvalidRequestError } from "@server/errors";

const router = new Router();

const collectionPermissionToLevel = (permission: CollectionPermission) =>
  permission === CollectionPermission.Manage
    ? PermissionLevel.Manage
    : permission === CollectionPermission.Edit
      ? PermissionLevel.Edit
      : PermissionLevel.Read;

const levelToCollectionPermission = (level: PermissionLevel) =>
  level === PermissionLevel.Manage
    ? CollectionPermission.Manage
    : level === PermissionLevel.Edit
      ? CollectionPermission.Edit
      : CollectionPermission.Read;

router.post(
  "collections.create",
  auth(),
  validate(T.CollectionsCreateSchema),
  transaction(),
  async (ctx: APIContext<T.CollectionsCreateReq>) => {
    const { transaction } = ctx.state;
    const {
      name,
      color,
      description,
      data,
      permission,
      sharing,
      icon,
      sort,
      index,
      commenting,
    } = ctx.input.body;

    const { user } = ctx.state.auth;
    authorize(user, "createCollection", user.team);

    const collection = Collection.build({
      name,
      content: data,
      description: data ? undefined : description,
      icon,
      color,
      teamId: user.teamId,
      createdById: user.id,
      ownerId: user.id,
      permission,
      sharing,
      sort,
      index,
      commenting,
    });

    if (data) {
      collection.description = await DocumentHelper.toMarkdown(collection, {
        includeTitle: false,
      });
    }

    await collection.saveWithCtx(ctx);

    // we must reload the collection to get memberships for policy presenter
    const reloaded = await Collection.findByPk(collection.id, {
      userId: user.id,
      transaction,
      rejectOnEmpty: true,
    });

    ctx.body = {
      data: await presentCollection(ctx, reloaded),
      policies: presentPolicies(user, [reloaded]),
    };
  }
);

router.post(
  "collections.info",
  auth(),
  validate(T.CollectionsInfoSchema),
  async (ctx: APIContext<T.CollectionsInfoReq>) => {
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;
    const collection = await Collection.findByPk(id, {
      userId: user.id,
      includeArchivedBy: true,
      rejectOnEmpty: true,
    });

    authorize(user, "read", collection);

    ctx.body = {
      data: await presentCollection(ctx, collection),
      policies: presentPolicies(user, [collection]),
    };
  }
);

router.post(
  "collections.documents",
  auth(),
  validate(T.CollectionsDocumentsSchema),
  async (ctx: APIContext<T.CollectionsDocumentsReq>) => {
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;
    const collection = await Collection.findByPk(id, {
      userId: user.id,
    });

    authorize(user, "readDocument", collection);

    const documentStructure = await CacheHelper.getDataOrSet(
      RedisPrefixHelper.getCollectionDocumentsKey(collection.id),
      async () =>
        (
          await Collection.findByPk(collection.id, {
            attributes: ["documentStructure"],
            includeDocumentStructure: true,
            rejectOnEmpty: true,
          })
        ).documentStructure,
      60
    );

    ctx.body = {
      data: documentStructure || [],
    };
  }
);

router.post(
  "collections.import",
  rateLimiter(RateLimiterStrategy.TenPerHour),
  auth(),
  validate(T.CollectionsImportSchema),
  transaction(),
  async (ctx: APIContext<T.CollectionsImportReq>) => {
    const { transaction } = ctx.state;
    const { attachmentId, permission, format } = ctx.input.body;
    const { user } = ctx.state.auth;
    authorize(user, "importCollection", user.team);

    const attachment = await Attachment.findByPk(attachmentId, {
      transaction,
    });
    authorize(user, "read", attachment);

    await FileOperation.createWithCtx(ctx, {
      type: FileOperationType.Import,
      state: FileOperationState.Creating,
      format,
      size: attachment.size,
      key: attachment.key,
      userId: user.id,
      teamId: user.teamId,
      options: {
        permission,
      },
    });

    ctx.body = {
      success: true,
    };
  }
);

router.post(
  "collections.add_group",
  auth(),
  validate(T.CollectionsAddGroupSchema),
  transaction(),
  async (ctx: APIContext<T.CollectionsAddGroupsReq>) => {
    const { id, groupId, permission } = ctx.input.body;
    const { transaction } = ctx.state;
    const { user } = ctx.state.auth;

    const [collection, group] = await Promise.all([
      Collection.findByPk(id, { userId: user.id, transaction }),
      Group.findByPk(groupId, { transaction }),
    ]);
    authorize(user, "update", collection);
    authorize(user, "read", group);

    await Permission.destroy({
      where: {
        teamId: user.teamId,
        subjectType: PermissionSubjectType.Group,
        subjectId: groupId,
        resourceType: PermissionResourceType.Collection,
        resourceId: id,
      },
      force: false,
      transaction,
    });
    const permissionGrant = await Permission.create(
      {
        teamId: user.teamId,
        subjectType: PermissionSubjectType.Group,
        subjectId: groupId,
        subjectRole: null,
        resourceType: PermissionResourceType.Collection,
        resourceId: id,
        permission: collectionPermissionToLevel(permission),
        inheritMode: PermissionInheritMode.Children,
        grantedById: user.id,
      },
      ctx.context
    );

    ctx.body = {
      data: {
        groupMemberships: [
          {
            id: permissionGrant.id,
            groupId,
            documentId: null,
            collectionId: id,
            permission,
            sourceId: null,
          },
        ],
      },
    };
  }
);

router.post(
  "collections.remove_group",
  auth(),
  validate(T.CollectionsRemoveGroupSchema),
  transaction(),
  async (ctx: APIContext<T.CollectionsRemoveGroupReq>) => {
    const { id, groupId } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const [collection, group] = await Promise.all([
      Collection.findByPk(id, {
        userId: user.id,
        transaction,
      }),
      Group.findByPk(groupId, {
        transaction,
      }),
    ]);
    authorize(user, "update", collection);
    authorize(user, "read", group);

    const existing = await Permission.findOne({
      where: {
        teamId: user.teamId,
        subjectType: PermissionSubjectType.Group,
        subjectId: groupId,
        resourceType: PermissionResourceType.Collection,
        resourceId: id,
      },
      transaction,
    });

    if (!existing) {
      ctx.throw(
        InvalidRequestError("This Group is not a part of the collection")
      );
    }

    await Permission.destroy({
      where: {
        teamId: user.teamId,
        subjectType: PermissionSubjectType.Group,
        subjectId: groupId,
        resourceType: PermissionResourceType.Collection,
        resourceId: id,
      },
      force: false,
      transaction,
    });

    ctx.body = {
      success: true,
    };
  }
);

router.post(
  "collections.group_memberships",
  auth(),
  pagination(),
  validate(T.CollectionsMembershipsSchema),
  async (ctx: APIContext<T.CollectionsMembershipsReq>) => {
    const { id, query, permission } = ctx.input.body;
    const { user } = ctx.state.auth;

    const collection = await Collection.findByPk(id, {
      userId: user.id,
    });
    authorize(user, "read", collection);

    let where: WhereOptions<Permission> = {
      teamId: user.teamId,
      subjectType: PermissionSubjectType.Group,
      resourceType: PermissionResourceType.Collection,
      resourceId: id,
      deletedAt: null,
    };
    const filteredGroupIds = query
      ? (
          await Group.findAll({
            where: {
              teamId: user.teamId,
              name: { [Op.iLike]: `%${query}%` },
            },
            attributes: ["id"],
          })
        ).map((group) => group.id)
      : null;

    if (permission) {
      where = {
        ...where,
        permission: collectionPermissionToLevel(permission),
      };
    }
    if (filteredGroupIds) {
      where = {
        ...where,
        subjectId: filteredGroupIds.length
          ? {
              [Op.in]: filteredGroupIds,
            }
          : null,
      };
    }

    const [total, memberships] = await Promise.all([
      Permission.count({ where }),
      Permission.findAll({
        where,
        order: [["createdAt", "DESC"]],
        offset: ctx.state.pagination.offset,
        limit: ctx.state.pagination.limit,
      }),
    ]);
    const groupIds = memberships
      .map((membership) => membership.subjectId)
      .filter(Boolean) as string[];
    const groups = groupIds.length
      ? await Group.findAll({
          where: {
            id: groupIds,
            teamId: user.teamId,
          },
          paranoid: false,
        })
      : [];

    const groupMemberships = memberships.map((membership) => ({
      id: membership.id,
      groupId: membership.subjectId!,
      documentId: null,
      collectionId: membership.resourceId,
      permission: levelToCollectionPermission(membership.permission),
      sourceId: null,
    }));

    ctx.body = {
      pagination: { ...ctx.state.pagination, total },
      data: {
        groupMemberships,
        groups: await Promise.all(groups.map((group) => presentGroup(group))),
      },
    };
  }
);

router.post(
  "collections.permissions",
  auth(),
  validate(T.CollectionsPermissionsSchema),
  async (ctx: APIContext<T.CollectionsPermissionsReq>) => {
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;

    const collection = await Collection.findByPk(id, {
      userId: user.id,
      rejectOnEmpty: true,
    });
    authorize(user, "read", collection);

    ctx.body = {
      data: await PermissionResolver.resolveForCollection({
        teamId: user.teamId,
        collectionId: id,
      }),
    };
  }
);

router.post(
  "collections.permissions_all",
  auth({ role: UserRole.Admin }),
  pagination(),
  validate(T.CollectionsPermissionsAllSchema),
  async (ctx: APIContext<T.CollectionsPermissionsAllReq>) => {
    const { query } = ctx.input.body;
    const { user } = ctx.state.auth;
    const [collections, documents, workspacePermissions, publishedShares] =
      await Promise.all([
      Collection.findAll({
        attributes: ["id"],
        where: {
          teamId: user.teamId,
          deletedAt: null,
        },
      }),
      Document.findAll({
        attributes: ["id", "collectionId"],
        where: {
          teamId: user.teamId,
          deletedAt: null,
        },
      }),
      Permission.findAll({
        where: {
          teamId: user.teamId,
          deletedAt: null,
          resourceType: PermissionResourceType.Workspace,
          resourceId: null,
        },
      }),
      Share.findAll({
        attributes: [
          "id",
          "teamId",
          "userId",
          "collectionId",
          "documentId",
          "urlId",
          "domain",
          "published",
          "createdAt",
        ],
        where: {
          teamId: user.teamId,
          revokedAt: null,
          published: true,
        },
      }),
    ]);

    const [collectionResolved, documentResolved] = await Promise.all([
      Promise.all(
        collections.map((collection) =>
          PermissionResolver.resolveForCollection({
            teamId: user.teamId,
            collectionId: collection.id,
          }).then((permissions) => ({ collectionId: collection.id, permissions }))
        )
      ),
      Promise.all(
        documents.map((document) =>
          PermissionResolver.resolveForDocument({
            teamId: user.teamId,
            documentId: document.id,
            collectionId: document.collectionId ?? null,
          }).then((permissions) => ({ documentId: document.id, permissions }))
        )
      ),
    ]);

    type AuditEntry = {
      id: string;
      teamId: string;
      subjectType: string;
      subjectId: string | null;
      subjectRole: string | null;
      resourceType: string;
      resourceId: string | null;
      permission: string;
      inheritMode: string;
      grantedById: string | null;
      source: string;
      sourceResourceType: string;
      sourceResourceId: string | null;
      subjectName?: string | null;
      shareId?: string | null;
      sharePublished?: boolean | null;
      shareCreatedAt?: Date | null;
    };

    const entries: AuditEntry[] = [
      ...workspacePermissions.map((permission) => ({
        id: permission.id,
        teamId: permission.teamId,
        subjectType: permission.subjectType,
        subjectId: permission.subjectId,
        subjectRole: permission.subjectRole,
        resourceType: PermissionResourceType.Workspace,
        resourceId: null,
        permission: permission.permission,
        inheritMode: permission.inheritMode,
        grantedById: permission.grantedById,
        source: "direct" as const,
        sourceResourceType: PermissionResourceType.Workspace,
        sourceResourceId: null as string | null,
      })),
      ...collectionResolved.flatMap(({ collectionId, permissions }) =>
        permissions.map((permission) => ({
          id: permission.id,
          teamId: permission.teamId,
          subjectType: permission.subjectType,
          subjectId: permission.subjectId,
          subjectRole: permission.subjectRole,
          resourceType: PermissionResourceType.Collection,
          resourceId: collectionId,
          permission: permission.permission,
          inheritMode: permission.inheritMode,
          grantedById: permission.grantedById,
          source: permission.source,
          sourceResourceType: permission.resourceType,
          sourceResourceId: permission.resourceId,
        }))
      ),
      ...documentResolved.flatMap(({ documentId, permissions }) =>
        permissions.map((permission) => ({
          id: permission.id,
          teamId: permission.teamId,
          subjectType: permission.subjectType,
          subjectId: permission.subjectId,
          subjectRole: permission.subjectRole,
          resourceType: PermissionResourceType.Document,
          resourceId: documentId,
          permission: permission.permission,
          inheritMode: permission.inheritMode,
          grantedById: permission.grantedById,
          source: permission.source,
          sourceResourceType: permission.resourceType,
          sourceResourceId: permission.resourceId,
        }))
      ),
      ...publishedShares.flatMap((share) => {
        const resourceType = share.documentId
          ? PermissionResourceType.Document
          : PermissionResourceType.Collection;
        const resourceId = share.documentId ?? share.collectionId;

        if (!resourceId) {
          return [];
        }

        return [
          {
            id: `share:${share.id}`,
            teamId: share.teamId,
            subjectType: PermissionSubjectType.Role,
            subjectId: null,
            subjectRole: "external",
            resourceType,
            resourceId,
            permission: PermissionLevel.Read,
            inheritMode: PermissionInheritMode.Self,
            grantedById: share.userId,
            source: "public_share" as const,
            sourceResourceType: resourceType,
            sourceResourceId: resourceId,
            subjectName: share.domain ?? share.urlId ?? share.id,
            shareId: share.id,
            sharePublished: share.published,
            shareCreatedAt: share.createdAt,
          },
        ];
      }),
    ];

    const normalizedQuery = query?.trim().toLowerCase();
    const filteredEntries = normalizedQuery
      ? entries.filter((entry) => {
          const haystack = [
            entry.subjectType,
            entry.subjectId ?? "",
            entry.subjectRole ?? "",
            entry.resourceType,
            entry.resourceId ?? "",
            entry.permission,
            entry.source,
            entry.sourceResourceType,
            entry.sourceResourceId ?? "",
            entry.subjectName ?? "",
            entry.shareId ?? "",
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(normalizedQuery);
        })
      : entries;

    const sortedEntries = filteredEntries.sort((a, b) => {
      if (a.resourceType !== b.resourceType) {
        return a.resourceType.localeCompare(b.resourceType);
      }
      if ((a.resourceId ?? "") !== (b.resourceId ?? "")) {
        return (a.resourceId ?? "").localeCompare(b.resourceId ?? "");
      }
      if (a.subjectType !== b.subjectType) {
        return a.subjectType.localeCompare(b.subjectType);
      }
      if ((a.subjectId ?? "") !== (b.subjectId ?? "")) {
        return (a.subjectId ?? "").localeCompare(b.subjectId ?? "");
      }
      if ((a.subjectRole ?? "") !== (b.subjectRole ?? "")) {
        return (a.subjectRole ?? "").localeCompare(b.subjectRole ?? "");
      }
      if (a.permission !== b.permission) {
        return a.permission.localeCompare(b.permission);
      }
      return a.id.localeCompare(b.id);
    });

    const total = sortedEntries.length;
    const paginatedEntries = sortedEntries.slice(
      ctx.state.pagination.offset,
      ctx.state.pagination.offset + ctx.state.pagination.limit
    );

    const userSubjectIds = paginatedEntries
      .filter(
        (permission) =>
          permission.subjectType === PermissionSubjectType.User &&
          permission.subjectId
      )
      .map((permission) => permission.subjectId!) as string[];
    const groupSubjectIds = paginatedEntries
      .filter(
        (permission) =>
          permission.subjectType === PermissionSubjectType.Group &&
          permission.subjectId
      )
      .map((permission) => permission.subjectId!) as string[];

    const [subjectUsers, subjectGroups] = await Promise.all([
      userSubjectIds.length
        ? User.findAll({
            where: {
              id: userSubjectIds,
              teamId: user.teamId,
            },
            paranoid: false,
          })
        : [],
      groupSubjectIds.length
        ? Group.findAll({
            where: {
              id: groupSubjectIds,
              teamId: user.teamId,
            },
            paranoid: false,
          })
        : [],
    ]);
    const userNameById = new Map(subjectUsers.map((u) => [u.id, u.name]));
    const groupNameById = new Map(subjectGroups.map((g) => [g.id, g.name]));

    ctx.body = {
      pagination: { ...ctx.state.pagination, total },
      data: paginatedEntries.map((permission) => ({
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
        source: permission.source,
        sourceResourceType: permission.sourceResourceType,
        sourceResourceId: permission.sourceResourceId,
        shareId: permission.shareId ?? null,
        sharePublished: permission.sharePublished ?? null,
        shareCreatedAt: permission.shareCreatedAt ?? null,
        subjectName:
          permission.subjectName ??
          (permission.subjectType === PermissionSubjectType.User
            ? permission.subjectId
              ? userNameById.get(permission.subjectId) ?? null
              : null
            : permission.subjectType === PermissionSubjectType.Group
              ? permission.subjectId
                ? groupNameById.get(permission.subjectId) ?? null
                : null
              : permission.subjectRole),
      })),
    };
  }
);

router.post(
  "collections.add_user",
  auth(),
  rateLimiter(RateLimiterStrategy.OneHundredPerHour),
  validate(T.CollectionsAddUserSchema),
  transaction(),
  async (ctx: APIContext<T.CollectionsAddUserReq>) => {
    const { transaction } = ctx.state;
    const { user: actor } = ctx.state.auth;
    const { id, userId, permission } = ctx.input.body;

    const [collection, user] = await Promise.all([
      Collection.findByPk(id, { userId: actor.id, transaction }),
      User.findByPk(userId, { transaction }),
    ]);
    authorize(actor, "update", collection);
    authorize(actor, "read", user);

    const resolvedPermission = permission || user.defaultCollectionPermission;

    await Permission.destroy({
      where: {
        teamId: actor.teamId,
        subjectType: PermissionSubjectType.User,
        subjectId: userId,
        resourceType: PermissionResourceType.Collection,
        resourceId: id,
      },
      force: false,
      transaction,
    });
    const permissionGrant = await Permission.create(
      {
        teamId: actor.teamId,
        subjectType: PermissionSubjectType.User,
        subjectId: userId,
        subjectRole: null,
        resourceType: PermissionResourceType.Collection,
        resourceId: id,
        permission: collectionPermissionToLevel(resolvedPermission),
        inheritMode: PermissionInheritMode.Children,
        grantedById: actor.id,
      },
      ctx.context
    );

    ctx.body = {
      data: {
        users: [presentUser(user)],
        memberships: [
          {
            id: permissionGrant.id,
            userId,
            documentId: null,
            collectionId: id,
            permission: resolvedPermission,
            createdById: actor.id,
            sourceId: null,
            index: null,
          },
        ],
      },
    };
  }
);

router.post(
  "collections.remove_user",
  auth(),
  validate(T.CollectionsRemoveUserSchema),
  transaction(),
  async (ctx: APIContext<T.CollectionsRemoveUserReq>) => {
    const { transaction } = ctx.state;
    const { user: actor } = ctx.state.auth;
    const { id, userId } = ctx.input.body;

    const [collection, user] = await Promise.all([
      Collection.findByPk(id, { userId: actor.id, transaction }),
      User.findByPk(userId, { transaction }),
    ]);
    authorize(actor, "update", collection);
    authorize(actor, "read", user);

    const existing = await Permission.findOne({
      where: {
        teamId: actor.teamId,
        subjectType: PermissionSubjectType.User,
        subjectId: userId,
        resourceType: PermissionResourceType.Collection,
        resourceId: id,
      },
      transaction,
    });
    if (!existing) {
      ctx.throw(InvalidRequestError("User is not a collection member"));
    }

    await Permission.destroy({
      where: {
        teamId: actor.teamId,
        subjectType: PermissionSubjectType.User,
        subjectId: userId,
        resourceType: PermissionResourceType.Collection,
        resourceId: id,
      },
      force: false,
      transaction,
    });

    ctx.body = {
      success: true,
    };
  }
);

router.post(
  "collections.memberships",
  auth(),
  pagination(),
  validate(T.CollectionsMembershipsSchema),
  async (ctx: APIContext<T.CollectionsMembershipsReq>) => {
    const { id, query, permission } = ctx.input.body;
    const { user } = ctx.state.auth;

    const collection = await Collection.findByPk(id, {
      userId: user.id,
    });
    authorize(user, "read", collection);

    let where: WhereOptions<Permission> = {
      teamId: user.teamId,
      subjectType: PermissionSubjectType.User,
      resourceType: PermissionResourceType.Collection,
      resourceId: id,
      deletedAt: null,
    };
    const filteredUserIds = query
      ? (
          await User.findAll({
            where: {
              teamId: user.teamId,
              name: { [Op.iLike]: `%${query}%` },
            },
            attributes: ["id"],
          })
        ).map((subjectUser) => subjectUser.id)
      : null;

    if (permission) {
      where = {
        ...where,
        permission: collectionPermissionToLevel(permission),
      };
    }
    if (filteredUserIds) {
      where = {
        ...where,
        subjectId: filteredUserIds.length
          ? {
              [Op.in]: filteredUserIds,
            }
          : null,
      };
    }

    const [total, memberships] = await Promise.all([
      Permission.count({ where }),
      Permission.findAll({
        where,
        order: [["createdAt", "DESC"]],
        offset: ctx.state.pagination.offset,
        limit: ctx.state.pagination.limit,
      }),
    ]);
    const userIds = memberships
      .map((membership) => membership.subjectId)
      .filter(Boolean) as string[];
    const users = userIds.length
      ? await User.findAll({
          where: {
            id: userIds,
            teamId: user.teamId,
          },
          paranoid: false,
        })
      : [];
    const usersById = new Map(
      users.map((subjectUser) => [subjectUser.id, subjectUser])
    );

    const visibleMemberships = memberships.filter((membership) =>
      usersById.has(membership.subjectId ?? "")
    );

    ctx.body = {
      pagination: { ...ctx.state.pagination, total },
      data: {
        memberships: visibleMemberships.map((membership) => ({
          id: membership.id,
          userId: membership.subjectId!,
          documentId: null,
          collectionId: membership.resourceId,
          permission: levelToCollectionPermission(membership.permission),
          createdById: membership.grantedById,
          sourceId: null,
          index: null,
        })),
        users: visibleMemberships.map((membership) =>
          presentUser(usersById.get(membership.subjectId!)!)
        ),
      },
    };
  }
);

router.post(
  "collections.export",
  rateLimiter(RateLimiterStrategy.FiftyPerHour),
  auth({ role: UserRole.Editor }),
  validate(T.CollectionsExportSchema),
  transaction(),
  async (ctx: APIContext<T.CollectionsExportReq>) => {
    const { id, format, includeAttachments } = ctx.input.body;
    const { transaction } = ctx.state;
    const { user } = ctx.state.auth;
    const { team } = user;

    const collection = await Collection.findByPk(id, {
      userId: user.id,
      transaction,
    });
    authorize(user, "export", collection);

    const fileOperation = await collectionExporter({
      collection,
      team,
      user,
      format,
      includeAttachments,
      ctx,
    });

    ctx.body = {
      success: true,
      data: {
        fileOperation: presentFileOperation(fileOperation),
      },
    };
  }
);

router.post(
  "collections.export_all",
  rateLimiter(RateLimiterStrategy.FivePerHour),
  auth({ role: UserRole.Manager }),
  validate(T.CollectionsExportAllSchema),
  transaction(),
  async (ctx: APIContext<T.CollectionsExportAllReq>) => {
    const { format, includeAttachments, includePrivate } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;
    const team = await Team.findByPk(user.teamId, { transaction });
    authorize(user, "createExport", team);

    const fileOperation = await collectionExporter({
      user,
      team,
      format,
      includeAttachments,
      includePrivate,
      ctx,
    });

    ctx.body = {
      success: true,
      data: {
        fileOperation: presentFileOperation(fileOperation),
      },
    };
  }
);

router.post(
  "collections.update",
  auth(),
  validate(T.CollectionsUpdateSchema),
  transaction(),
  async (ctx: APIContext<T.CollectionsUpdateReq>) => {
    const { transaction } = ctx.state;
    const {
      id,
      name,
      description,
      data,
      icon,
      permission,
      color,
      sort,
      sharing,
      commenting,
    } = ctx.input.body;

    const { user } = ctx.state.auth;
    const collection = await Collection.findByPk(id, {
      userId: user.id,
      transaction,
    });
    authorize(user, "update", collection);

    let privacyChanged = false;
    let sharingChanged = false;

    if (name !== undefined) {
      collection.name = name.trim();
    }

    if (description !== undefined) {
      collection.description = description;
      collection.content = description
        ? parser.parse(description)?.toJSON()
        : null;
    }

    if (data !== undefined) {
      collection.content = data;
      collection.description = await DocumentHelper.toMarkdown(collection, {
        includeTitle: false,
      });
    }

    if (icon !== undefined) {
      collection.icon = icon;
    }

    if (color !== undefined) {
      collection.color = color;
    }

    if (permission !== undefined) {
      privacyChanged = permission !== collection.effectivePermission;
      collection.permission = permission ? permission : null;

      await Permission.destroy({
        where: {
          teamId: user.teamId,
          subjectType: PermissionSubjectType.Role,
          subjectRole: "viewer",
          resourceType: PermissionResourceType.Collection,
          resourceId: collection.id,
        },
        force: false,
        transaction,
      });
      await Permission.destroy({
        where: {
          teamId: user.teamId,
          subjectType: PermissionSubjectType.Role,
          subjectRole: "editor",
          resourceType: PermissionResourceType.Collection,
          resourceId: collection.id,
        },
        force: false,
        transaction,
      });
      const roleGrants: Array<{
        subjectRole: "viewer" | "editor";
        permission: PermissionLevel;
      }> = [];

      if (permission === CollectionPermission.Read) {
        roleGrants.push(
          { subjectRole: "viewer", permission: PermissionLevel.Read },
          { subjectRole: "editor", permission: PermissionLevel.Read }
        );
      } else if (permission === CollectionPermission.Edit) {
        roleGrants.push(
          { subjectRole: "viewer", permission: PermissionLevel.Read },
          { subjectRole: "editor", permission: PermissionLevel.Edit }
        );
      }

      if (roleGrants.length) {
        await Permission.bulkCreate(
          roleGrants.map((grant) => ({
            teamId: user.teamId,
            subjectType: PermissionSubjectType.Role,
            subjectId: null,
            subjectRole: grant.subjectRole,
            resourceType: PermissionResourceType.Collection,
            resourceId: collection.id,
            permission: grant.permission,
            inheritMode: PermissionInheritMode.Children,
            grantedById: user.id,
          })),
          ctx.context
        );
      }
    }

    if (sharing !== undefined) {
      sharingChanged = sharing !== collection.sharing;
      collection.sharing = sharing;
    }

    if (sort !== undefined) {
      collection.sort = sort;
    }

    if (commenting !== undefined) {
      collection.commenting = commenting;
    }

    await collection.saveWithCtx(ctx);

    // Must reload to update permission grants for correct policy calculation
    // if the privacy level has changed. Otherwise skip this query for speed.
    if (privacyChanged || sharingChanged) {
      await collection.reload({ transaction });
      const team = await Team.findByPk(user.teamId, {
        transaction,
        rejectOnEmpty: true,
      });

      if (
        collection.effectivePermission === null &&
        team?.defaultCollectionId === collection.id
      ) {
        await teamUpdater(ctx, {
          params: { defaultCollectionId: null },
          user,
          team,
        });
      }
    }

    ctx.body = {
      data: await presentCollection(ctx, collection),
      policies: presentPolicies(user, [collection]),
    };
  }
);

router.post(
  "collections.list",
  auth(),
  validate(T.CollectionsListSchema),
  pagination(),
  transaction(),
  async (ctx: APIContext<T.CollectionsListReq>) => {
    const { query, statusFilter } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const where: WhereOptions<Collection> & {
      [Op.and]: WhereOptions<Collection>[];
    } = {
      teamId: user.teamId,
      [Op.and]: [
        {
          deletedAt: {
            [Op.eq]: null,
          },
        },
      ],
    };

    if (!statusFilter) {
      where[Op.and].push({ archivedAt: { [Op.eq]: null } });
    }

    if (query) {
      where[Op.and].push(
        Sequelize.literal(`unaccent(LOWER(name)) like unaccent(LOWER(:query))`)
      );
    }

    const statusQuery = [];
    if (statusFilter?.includes(CollectionStatusFilter.Archived)) {
      statusQuery.push({
        archivedAt: {
          [Op.ne]: null,
        },
      });
    }

    if (statusQuery.length) {
      where[Op.and].push({
        [Op.or]: statusQuery,
      });
    }

    const replacements = { query: `%${query}%` };

    const [collections, total] = await Promise.all([
      Collection.scope(
        statusFilter?.includes(CollectionStatusFilter.Archived)
          ? [
              {
                method: ["withPermissionGrants", user.id],
              },
              "withArchivedBy",
            ]
          : {
              method: ["withPermissionGrants", user.id],
            }
      ).findAll({
        where,
        replacements,
        order: [
          Sequelize.literal('"collection"."index" collate "C"'),
          ["updatedAt", "DESC"],
        ],
        offset: ctx.state.pagination.offset,
        limit: ctx.state.pagination.limit,
        transaction,
      }),
      Collection.count({
        where,
        // @ts-expect-error Types are incorrect for count
        replacements,
        transaction,
      }),
    ]);

    const nullIndex = collections.findIndex(
      (collection) => collection.index === null
    );

    if (nullIndex !== -1) {
      const indexedCollections = await collectionIndexing(user.teamId, {
        transaction,
      });
      collections.forEach((collection) => {
        collection.index = indexedCollections[collection.id];
      });
    }

    ctx.body = {
      pagination: { ...ctx.state.pagination, total },
      data: await Promise.all(
        collections.map((collection) => presentCollection(ctx, collection))
      ),
      policies: presentPolicies(user, collections),
    };
  }
);

router.post(
  "collections.delete",
  auth(),
  validate(T.CollectionsDeleteSchema),
  transaction(),
  async (ctx: APIContext<T.CollectionsDeleteReq>) => {
    const { transaction } = ctx.state;
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;

    const collection = await Collection.findByPk(id, {
      userId: user.id,
      transaction,
    });

    authorize(user, "delete", collection);

    await collection.destroyWithCtx(ctx);

    ctx.body = {
      success: true,
    };
  }
);

router.post(
  "collections.archive",
  auth(),
  validate(T.CollectionsArchiveSchema),
  transaction(),
  async (ctx: APIContext<T.CollectionsArchiveReq>) => {
    const { transaction } = ctx.state;
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;

    const collection = await Collection.findByPk(id, {
      userId: user.id,
      transaction,
      rejectOnEmpty: true,
    });

    authorize(user, "archive", collection);

    collection.archivedAt = new Date();
    collection.archivedById = user.id;
    collection.archivedBy = user;

    await collection.saveWithCtx(ctx, undefined, {
      name: "archive",
    });

    // Archive all documents within the collection
    await Document.update(
      {
        lastModifiedById: user.id,
        archivedAt: collection.archivedAt,
      },
      {
        where: {
          teamId: collection.teamId,
          collectionId: collection.id,
          archivedAt: {
            [Op.is]: null,
          },
        },
        transaction,
      }
    );

    ctx.body = {
      data: await presentCollection(ctx, collection),
      policies: presentPolicies(user, [collection]),
    };
  }
);

router.post(
  "collections.restore",
  auth(),
  validate(T.CollectionsRestoreSchema),
  transaction(),
  async (ctx: APIContext<T.CollectionsRestoreReq>) => {
    const { transaction } = ctx.state;
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;

    let collection = await Collection.findByPk(id, {
      userId: user.id,
      includeDocumentStructure: true,
      rejectOnEmpty: true,
      transaction,
    });

    authorize(user, "restore", collection);

    await Document.update(
      {
        lastModifiedById: user.id,
        archivedAt: null,
      },
      {
        where: {
          collectionId: collection.id,
          teamId: user.teamId,
          archivedAt: collection.archivedAt,
        },
        transaction,
      }
    );

    collection.archivedAt = null;
    collection.archivedById = null;
    collection = await collection.saveWithCtx(ctx, undefined, {
      name: "restore",
    });

    ctx.body = {
      data: await presentCollection(ctx, collection!),
      policies: presentPolicies(user, [collection]),
    };
  }
);

router.post(
  "collections.move",
  auth(),
  validate(T.CollectionsMoveSchema),
  transaction(),
  async (ctx: APIContext<T.CollectionsMoveReq>) => {
    const { transaction } = ctx.state;
    const { id, index } = ctx.input.body;
    const { user } = ctx.state.auth;

    const collectionForAuthorization = await Collection.findByPk(id, {
      userId: user.id,
      transaction,
    });
    authorize(user, "move", collectionForAuthorization);

    let collection = await Collection.findByPk(id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
      rejectOnEmpty: true,
    });

    collection = await collection.updateWithCtx(
      ctx,
      { index },
      {
        name: "move",
      }
    );

    ctx.body = {
      success: true,
      data: {
        index: collection.index,
      },
    };
  }
);

export default router;
