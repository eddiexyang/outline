import path from "node:path";
import fs from "fs-extra";
import invariant from "invariant";
import contentDisposition from "content-disposition";
import JSZip from "jszip";
import Router from "koa-router";
import escapeRegExp from "lodash/escapeRegExp";
import has from "lodash/has";
import remove from "lodash/remove";
import uniq from "lodash/uniq";
import mime from "mime-types";
import type { Order, ScopeOptions, WhereOptions } from "sequelize";
import { Op, Sequelize } from "sequelize";
import { randomUUID } from "node:crypto";
import type { DirectionFilter, SortFilter } from "@shared/types";
import { type NavigationNode } from "@shared/types";
import {
  DocumentPermission,
  FileOperationFormat,
  FileOperationState,
  FileOperationType,
  StatusFilter,
  UserRole,
} from "@shared/types";
import { subtractDate } from "@shared/utils/date";
import slugify from "@shared/utils/slugify";
import documentCreator from "@server/commands/documentCreator";
import documentDuplicator from "@server/commands/documentDuplicator";
import documentLoader from "@server/commands/documentLoader";
import documentMover from "@server/commands/documentMover";
import documentPermanentDeleter from "@server/commands/documentPermanentDeleter";
import documentUpdater from "@server/commands/documentUpdater";
import env from "@server/env";
import {
  InvalidRequestError,
  AuthenticationError,
  ValidationError,
  IncorrectEditionError,
  NotFoundError,
} from "@server/errors";
import Logger from "@server/logging/Logger";
import auth from "@server/middlewares/authentication";
import multipart from "@server/middlewares/multipart";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import { transaction } from "@server/middlewares/transaction";
import validate from "@server/middlewares/validate";
import {
  Attachment,
  Relationship,
  Collection,
  Document,
  Event,
  Revision,
  SearchQuery,
  Template,
  User,
  View,
  Group,
  GroupUser,
  Permission,
  FileOperation,
} from "@server/models";
import {
  PermissionInheritMode,
  PermissionLevel,
  PermissionResourceType,
  PermissionSubjectType,
} from "@server/models/Permission";
import AttachmentHelper from "@server/models/helpers/AttachmentHelper";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";
import { ProsemirrorHelper } from "@server/models/helpers/ProsemirrorHelper";
import SearchHelper from "@server/models/helpers/SearchHelper";
import { TextHelper } from "@server/models/helpers/TextHelper";
import { authorize, cannot } from "@server/policies";
import {
  presentDocument,
  presentPolicies,
  presentTemplate,
  presentUser,
  presentGroup,
  presentFileOperation,
} from "@server/presenters";
import type { DocumentImportTaskResponse } from "@server/queues/tasks/DocumentImportTask";
import DocumentImportTask from "@server/queues/tasks/DocumentImportTask";
import EmptyTrashTask from "@server/queues/tasks/EmptyTrashTask";
import FileStorage from "@server/storage/files";
import type { APIContext } from "@server/types";
import { RateLimiterStrategy } from "@server/utils/RateLimiter";
import ZipHelper from "@server/utils/ZipHelper";
import { convertBareUrlsToEmbedMarkdown } from "@server/utils/embeds";
import { getTeamFromContext } from "@server/utils/passport";
import { assertPresent } from "@server/validation";
import pagination from "../middlewares/pagination";
import * as T from "./schema";
import {
  loadPublicShare,
  getAllIdsInSharedTree,
} from "@server/commands/shareLoader";
import PermissionResolver from "@server/services/permissions/PermissionResolver";

const router = new Router();

const documentPermissionToLevel = (permission: DocumentPermission) =>
  permission === DocumentPermission.Manage
    ? PermissionLevel.Manage
    : permission === DocumentPermission.Edit
      ? PermissionLevel.Edit
      : PermissionLevel.Read;

const levelToDocumentPermission = (level: PermissionLevel) =>
  level === PermissionLevel.Manage
    ? DocumentPermission.Manage
    : level === PermissionLevel.Edit
      ? DocumentPermission.Edit
      : DocumentPermission.Read;

router.post(
  "documents.list",
  auth(),
  pagination(),
  validate(T.DocumentsListSchema),
  async (ctx: APIContext<T.DocumentsListReq>) => {
    const {
      sort,
      direction,
      collectionId,
      backlinkDocumentId,
      parentDocumentId,
      userId: createdById,
      statusFilter,
    } = ctx.input.body;

    // always filter by the current team
    const { user } = ctx.state.auth;
    const where: WhereOptions<Document> & {
      [Op.and]: WhereOptions<Document>[];
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

    // Exclude archived docs by default
    if (!statusFilter) {
      where[Op.and].push({ archivedAt: { [Op.eq]: null } });
    }

    // if a specific user is passed then add to filters. If the user doesn't
    // exist in the team then nothing will be returned, so no need to check auth
    if (createdById) {
      where[Op.and].push({ createdById });
    }

    let documentIds: string[] = [];

    // if a specific collection is passed then we need to check auth to view it
    if (collectionId) {
      where[Op.and].push({ collectionId: [collectionId] });
      const collection = await Collection.findByPk(collectionId, {
        userId: user.id,
        includeDocumentStructure: sort === "index",
      });

      authorize(user, "readDocument", collection);

      // index sort is special because it uses the order of the documents in the
      // collection.documentStructure rather than a database column
      if (sort === "index") {
        // Extract all document IDs from the collection structure.
        documentIds = (collection.documentStructure || [])
          .map((node) => node.id)
          .slice(
            ctx.state.pagination.offset,
            ctx.state.pagination.offset + ctx.state.pagination.limit
          );
        where[Op.and].push({ id: documentIds });
      } // if it's not a backlink request, filter by all collections the user has access to
    } else if (!backlinkDocumentId) {
      const collectionIds = await user.collectionIds();
      where[Op.and].push({
        collectionId: collectionIds,
      });
    }

    if (parentDocumentId) {
      const groupIds = await user.groupIds();
      const directDocumentPermission = await Permission.findOne({
        attributes: ["id"],
        where: {
          teamId: user.teamId,
          deletedAt: null,
          resourceType: PermissionResourceType.Document,
          resourceId: parentDocumentId,
          [Op.or]: [
            {
              subjectType: PermissionSubjectType.User,
              subjectId: user.id,
            },
            {
              subjectType: PermissionSubjectType.Role,
              subjectRole: user.role,
            },
            ...(groupIds.length
              ? [
                  {
                    subjectType: PermissionSubjectType.Group,
                    subjectId: {
                      [Op.in]: groupIds,
                    },
                  },
                ]
              : []),
          ],
        },
      });

      if (directDocumentPermission) {
        remove(where[Op.and], (cond) => has(cond, "collectionId"));
      }

      where[Op.and].push({ parentDocumentId });
    }

    // Explicitly passing 'null' as the parentDocumentId allows listing documents
    // that have no parent document (aka they are at the root of the collection)
    if (parentDocumentId === null) {
      where[Op.and].push({
        parentDocumentId: {
          [Op.is]: null,
        },
      });
    }

    if (backlinkDocumentId) {
      const sourceDocumentIds = await Relationship.findSourceDocumentIdsForUser(
        backlinkDocumentId,
        user
      );

      where[Op.and].push({ id: sourceDocumentIds });

      // For safety, ensure the collectionId is not set in the query.
      remove(where[Op.and], (cond) => has(cond, "collectionId"));
    }

    const statusQuery = [];
    if (statusFilter?.includes(StatusFilter.Published)) {
      statusQuery.push({
        [Op.and]: [
          {
            publishedAt: {
              [Op.ne]: null,
            },
            archivedAt: {
              [Op.eq]: null,
            },
          },
        ],
      });
    }

    if (statusFilter?.includes(StatusFilter.Draft)) {
      statusQuery.push({
        [Op.and]: [
          {
            publishedAt: {
              [Op.eq]: null,
            },
            archivedAt: {
              [Op.eq]: null,
            },
            [Op.or]: [
              // Only ever include draft results for the user's own documents
              { createdById: user.id },
              { "$permissionGrants.id$": { [Op.ne]: null } },
            ],
          },
        ],
      });
    }

    if (statusFilter?.includes(StatusFilter.Archived)) {
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

    // When sorting by index, use array_position to sort by the document order
    // in the collection structure directly in SQL, enabling correct pagination
    const orderClause =
      sort === "index"
        ? documentIds.length > 0
          ? [
              [
                Sequelize.literal(
                  `array_position(ARRAY[${documentIds.map((id) => `'${id}'`).join(",")}]::uuid[], "document"."id")`
                ),
                direction,
              ],
            ]
          : undefined
        : [[sort, direction]];

    // When sorting by index, pagination is already handled by slicing documentIds,
    // so we skip the SQL-level offset to avoid double-pagination
    const [documents, total] = await Promise.all([
      Document.withPermissionScope(user.id).findAll({
        where,
        order: orderClause as Order,
        offset: sort === "index" ? 0 : ctx.state.pagination.offset,
        limit: ctx.state.pagination.limit,
      }),
      Document.count({ where }),
    ]);

    const data = await Promise.all(
      documents.map((document) => presentDocument(ctx, document))
    );
    const policies = presentPolicies(user, documents);

    ctx.body = {
      pagination: { ...ctx.state.pagination, total },
      data,
      policies,
    };
  }
);

router.post(
  "documents.archived",
  auth({ role: UserRole.Editor }),
  pagination(),
  validate(T.DocumentsArchivedSchema),
  async (ctx: APIContext<T.DocumentsArchivedReq>) => {
    const { sort, direction, collectionId } = ctx.input.body;
    const { user } = ctx.state.auth;

    if (sort === "index") {
      throw ValidationError(
        "Sorting archived documents by index is not supported"
      );
    }

    let where: WhereOptions<Document> = {
      teamId: user.teamId,
      archivedAt: {
        [Op.ne]: null,
      },
    };

    // if a specific collection is passed then we need to check auth to view it
    if (collectionId) {
      where = { ...where, collectionId };
      const collection = await Collection.findByPk(collectionId, {
        userId: user.id,
      });
      authorize(user, "readDocument", collection);

      // otherwise, filter by all collections the user has access to
    } else {
      const collectionIds = await user.collectionIds();
      where = {
        ...where,
        collectionId: collectionIds,
      };
    }

    const documents = await Document.withPermissionScope(user.id).findAll({
      where,
      order: [[sort, direction]],
      offset: ctx.state.pagination.offset,
      limit: ctx.state.pagination.limit,
    });

    const data = await Promise.all(
      documents.map((document) => presentDocument(ctx, document))
    );
    const policies = presentPolicies(user, documents);

    ctx.body = {
      pagination: ctx.state.pagination,
      data,
      policies,
    };
  }
);

router.post(
  "documents.deleted",
  auth({ role: UserRole.Editor }),
  pagination(),
  validate(T.DocumentsDeletedSchema),
  async (ctx: APIContext<T.DocumentsDeletedReq>) => {
    const { sort, direction } = ctx.input.body;
    const { user } = ctx.state.auth;
    const collectionIds = await user.collectionIds({
      paranoid: false,
    });
    const permissionGrantScope: Readonly<ScopeOptions> = {
      method: ["withPermissionGrants", user.id],
    };
    const viewScope: Readonly<ScopeOptions> = {
      method: ["withViews", user.id],
    };
    const documents = await Document.scope([
      permissionGrantScope,
      viewScope,
      "withDrafts",
    ]).findAll({
      where: {
        teamId: user.teamId,
        deletedAt: {
          [Op.ne]: null,
        },
        [Op.or]: [
          {
            collectionId: {
              [Op.in]: collectionIds,
            },
          },
          {
            createdById: user.id,
            collectionId: {
              [Op.is]: null,
            },
          },
        ],
      },
      paranoid: false,
      order: [[sort, direction]],
      offset: ctx.state.pagination.offset,
      limit: ctx.state.pagination.limit,
    });
    const data = await Promise.all(
      documents.map((document) => presentDocument(ctx, document))
    );
    const policies = presentPolicies(user, documents);

    ctx.body = {
      pagination: ctx.state.pagination,
      data,
      policies,
    };
  }
);

router.post(
  "documents.viewed",
  auth(),
  pagination(),
  validate(T.DocumentsViewedSchema),
  async (ctx: APIContext<T.DocumentsViewedReq>) => {
    const { sort, direction } = ctx.input.body;
    const { user } = ctx.state.auth;
    const collectionIds = await user.collectionIds();
    const userId = user.id;
    const views = await View.findAll({
      where: {
        userId,
      },
      order: [[sort, direction]],
      include: [
        {
          model: Document.scope([
            "withDrafts",
            { method: ["withPermissionGrants", userId] },
          ]),
          required: true,
          where: {
            teamId: user.teamId,
            collectionId: collectionIds,
          },
        },
      ],
      offset: ctx.state.pagination.offset,
      limit: ctx.state.pagination.limit,
      subQuery: false,
    });
    const documents = views.map((view) => {
      const document = view.document;
      document.views = [view];
      return document;
    });
    const data = await Promise.all(
      documents.map((document) => presentDocument(ctx, document))
    );
    const policies = presentPolicies(user, documents);

    ctx.body = {
      pagination: ctx.state.pagination,
      data,
      policies,
    };
  }
);

router.post(
  "documents.drafts",
  auth(),
  pagination(),
  validate(T.DocumentsDraftsSchema),
  async (ctx: APIContext<T.DocumentsDraftsReq>) => {
    const { collectionId, dateFilter, direction, sort } = ctx.input.body;
    const { user } = ctx.state.auth;

    if (collectionId) {
      const collection = await Collection.findByPk(collectionId, {
        userId: user.id,
      });
      authorize(user, "readDocument", collection);
    }

    const collectionIds = collectionId
      ? [collectionId]
      : await user.collectionIds();
    const where: WhereOptions = {
      teamId: user.teamId,
      createdById: user.id,
      collectionId: {
        [Op.or]: [{ [Op.in]: collectionIds }, { [Op.is]: null }],
      },
      publishedAt: {
        [Op.is]: null,
      },
    };

    if (dateFilter) {
      where.updatedAt = {
        [Op.gte]: subtractDate(new Date(), dateFilter),
      };
    } else {
      delete where.updatedAt;
    }

    const documents = await Document.withPermissionScope(user.id, {
      includeDrafts: true,
    }).findAll({
      where,
      order: [[sort, direction]],
      offset: ctx.state.pagination.offset,
      limit: ctx.state.pagination.limit,
    });
    const data = await Promise.all(
      documents.map((document) => presentDocument(ctx, document))
    );
    const policies = presentPolicies(user, documents);

    ctx.body = {
      pagination: ctx.state.pagination,
      data,
      policies,
    };
  }
);

router.post(
  "documents.info",
  auth({ optional: true }),
  validate(T.DocumentsInfoSchema),
  async (ctx: APIContext<T.DocumentsInfoReq>) => {
    const { id, shareId } = ctx.input.body;
    const { user } = ctx.state.auth;
    const apiVersion = getAPIVersion(ctx);
    const teamFromCtx = await getTeamFromContext(ctx, {
      includeStateCookie: false,
    });

    let document: Document | null;
    let serializedDocument: Record<string, unknown> | undefined;
    let isPublic = false;

    if (shareId) {
      const result = await loadPublicShare({
        id: shareId,
        documentId: id,
        teamId: teamFromCtx?.id,
      });

      document = result.document;

      if (!document) {
        throw NotFoundError("Document could not be found for shareId");
      }

      // reload with permission grant scope if user is authenticated
      if (user) {
        document = await Document.findByPk(document.id, {
          userId: user.id,
          rejectOnEmpty: true,
        });
      }

      isPublic = cannot(user, "read", document);

      // Get backlinks that are within the shared tree
      let backlinkIds: string[] | undefined;
      if (result.sharedTree) {
        const allowedDocumentIds = getAllIdsInSharedTree(result.sharedTree);
        backlinkIds = await Relationship.findSourceDocumentIdsInSharedTree(
          document.id,
          allowedDocumentIds
        );
      }

      serializedDocument = await presentDocument(ctx, document, {
        isPublic,
        shareId,
        includeUpdatedAt: result.share.showLastUpdated,
        backlinkIds,
      });
    } else {
      if (!user) {
        throw AuthenticationError("Authentication required");
      }

      document = await documentLoader({
        id: id!, // validation ensures id will be present here
        user,
      });
      serializedDocument = await presentDocument(ctx, document);
    }

    ctx.body = {
      // Passing apiVersion=2 has a single effect, to change the response payload to
      // include top level keys for document.
      data:
        apiVersion >= 2
          ? {
              document: serializedDocument,
            }
          : serializedDocument,
      policies: isPublic ? undefined : presentPolicies(user, [document]),
    };
  }
);

router.post(
  "documents.users",
  auth(),
  pagination(),
  validate(T.DocumentsUsersSchema),
  async (ctx: APIContext<T.DocumentsUsersReq>) => {
    const { id, userId, query } = ctx.input.body;
    const actor = ctx.state.auth.user;
    const { offset, limit } = ctx.state.pagination;
    const document = await Document.findByPk(id, {
      userId: actor.id,
    });
    authorize(actor, "read", document);

    let where: WhereOptions<User> = {
      teamId: document.teamId,
      suspendedAt: {
        [Op.is]: null,
      },
    };

    const [collection, documentPermissions, collectionPermissions] =
      await Promise.all([
        document.$get("collection"),
        Permission.findAll({
          attributes: ["subjectType", "subjectId"],
          where: {
            teamId: document.teamId,
            deletedAt: null,
            resourceType: PermissionResourceType.Document,
            resourceId: document.id,
            subjectType: {
              [Op.in]: [
                PermissionSubjectType.User,
                PermissionSubjectType.Group,
              ],
            },
          },
        }),
        document.collectionId
          ? Permission.findAll({
              attributes: ["subjectType", "subjectId"],
              where: {
                teamId: document.teamId,
                deletedAt: null,
                resourceType: PermissionResourceType.Collection,
                resourceId: document.collectionId,
                subjectType: {
                  [Op.in]: [
                    PermissionSubjectType.User,
                    PermissionSubjectType.Group,
                  ],
                },
              },
            })
          : Promise.resolve([]),
      ]);

    if (!collection?.permission) {
      const grants = [...documentPermissions, ...collectionPermissions];
      const groupIds = uniq(
        grants
          .filter(
            (permission) =>
              permission.subjectType === PermissionSubjectType.Group &&
              !!permission.subjectId
          )
          .map((permission) => permission.subjectId as string)
      );

      const groupUsers = groupIds.length
        ? await GroupUser.findAll({
            attributes: ["userId"],
            raw: true,
            where: {
              groupId: {
                [Op.in]: groupIds,
              },
            },
          })
        : [];

      const permissionUserIds = uniq([
        ...grants
          .filter(
            (permission) =>
              permission.subjectType === PermissionSubjectType.User &&
              !!permission.subjectId
          )
          .map((permission) => permission.subjectId as string),
        ...groupUsers.map((groupUser) => groupUser.userId),
      ]);

      where = {
        ...where,
        id: {
          [Op.in]: permissionUserIds,
        },
      };
    }

    if (query) {
      where = {
        ...where,
        [Op.and]: [
          Sequelize.literal(
            `unaccent(LOWER(name)) like unaccent(LOWER(:query))`
          ),
        ],
      };
    }

    if (userId) {
      where = {
        ...where,
        id: userId,
      };
    }

    const replacements = { query: `%${query}%` };

    const [users, total] = await Promise.all([
      User.findAll({ where, replacements, offset, limit }),
      User.count({
        where,
        // @ts-expect-error Types are incorrect for count
        replacements,
      }),
    ]);

    ctx.body = {
      pagination: { ...ctx.state.pagination, total },
      data: users.map((user) => presentUser(user)),
      policies: presentPolicies(actor, users),
    };
  }
);

router.post(
  "documents.documents",
  auth(),
  validate(T.DocumentsChildrenSchema),
  async (ctx: APIContext<T.DocumentsChildrenReq>) => {
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;
    const document = await Document.findByPk(id, { userId: user.id });

    authorize(user, "read", document);

    let documentTree: NavigationNode | undefined;

    if (document.collectionId) {
      const collection = await Collection.findByPk(document.collectionId, {
        includeDocumentStructure: true,
      });
      documentTree = collection?.getDocumentTree(document.id) ?? undefined;
    }

    ctx.body = {
      data: documentTree,
    };
  }
);

router.post(
  "documents.permissions",
  auth(),
  validate(T.DocumentsPermissionsSchema),
  async (ctx: APIContext<T.DocumentsPermissionsReq>) => {
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;
    const document = await Document.findByPk(id, {
      userId: user.id,
      rejectOnEmpty: true,
    });

    authorize(user, "read", document);

    ctx.body = {
      data: await PermissionResolver.resolveForDocument({
        teamId: user.teamId,
        documentId: document.id,
        collectionId: document.collectionId ?? null,
      }),
    };
  }
);

router.post(
  "documents.export",
  rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
  auth(),
  validate(T.DocumentsExportSchema),
  async (ctx: APIContext<T.DocumentsExportReq>) => {
    const { id, signedUrls, includeChildDocuments } = ctx.input.body;
    const { user } = ctx.state.auth;
    const accept = ctx.request.headers["accept"];

    const document = await documentLoader({
      id,
      user,
      // We need the collaborative state to generate HTML.
      includeState: !accept?.includes("text/markdown"),
    });

    authorize(user, "download", document);

    const format = accept?.includes("text/html")
      ? FileOperationFormat.HTMLZip
      : accept?.includes("text/markdown")
        ? FileOperationFormat.MarkdownZip
        : accept?.includes("application/pdf")
          ? FileOperationFormat.PDF
          : null;

    if (format === FileOperationFormat.PDF) {
      throw IncorrectEditionError(
        "PDF export is not available in the community edition"
      );
    }

    if (includeChildDocuments) {
      if (!format) {
        throw InvalidRequestError(
          "format needed for exporting nested documents"
        );
      }

      const fileOperation = await FileOperation.createWithCtx(ctx, {
        type: FileOperationType.Export,
        state: FileOperationState.Creating,
        format,
        key: FileOperation.getExportKey({
          name: document.titleWithDefault,
          teamId: document.teamId,
          format,
        }),
        url: null,
        size: 0,
        documentId: document.id,
        userId: user.id,
        teamId: document.teamId,
      });

      fileOperation.user = user;
      fileOperation.document = document;

      ctx.body = {
        success: true,
        data: {
          fileOperation: presentFileOperation(fileOperation),
        },
      };
      return;
    }

    let contentType: string;
    let content: string;

    const toMarkdown = async () =>
      DocumentHelper.toMarkdown(document, {
        signedUrls,
        teamId: user.teamId,
      });

    if (format === FileOperationFormat.HTMLZip) {
      contentType = "text/html";
      content = await DocumentHelper.toHTML(document, {
        centered: true,
        includeMermaid: true,
      });
    } else if (format === FileOperationFormat.MarkdownZip) {
      contentType = "text/markdown";
      content = await toMarkdown();
    } else {
      ctx.body = {
        data: await toMarkdown(),
      };
      return;
    }

    // Override the extension for Markdown as it's incorrect in the mime-types
    // library until a new release > 2.1.35
    const extension =
      contentType === "text/markdown" ? "md" : mime.extension(contentType);

    const fileName = slugify(document.titleWithDefault);
    const attachmentIds = ProsemirrorHelper.parseAttachmentIds(
      DocumentHelper.toProsemirror(document)
    );
    const attachments = attachmentIds.length
      ? await Attachment.findAll({
          where: {
            teamId: document.teamId,
            id: attachmentIds,
          },
        })
      : [];

    if (attachments.length === 0) {
      ctx.set("Content-Type", contentType);
      ctx.set(
        "Content-Disposition",
        contentDisposition(`${fileName}.${extension}`, {
          type: "attachment",
        })
      );
      ctx.body = content;
      return;
    }

    const zip = new JSZip();

    await Promise.all(
      attachments.map(async (attachment) => {
        const location = path.join(
          "attachments",
          `${attachment.id}.${mime.extension(attachment.contentType)}`
        );
        zip.file(
          location,
          new Promise<Buffer>((resolve) => {
            attachment.buffer.then(resolve).catch((err) => {
              Logger.warn(`Failed to read attachment from storage`, {
                attachmentId: attachment.id,
                teamId: attachment.teamId,
                error: err.message,
              });
              resolve(Buffer.from(""));
            });
          }),
          {
            date: attachment.updatedAt,
            createFolders: true,
          }
        );

        content = content.replace(
          new RegExp(escapeRegExp(attachment.redirectUrl), "g"),
          location
        );
      })
    );

    zip.file(`${fileName}.${extension}`, content, {
      date: document.updatedAt,
    });

    ctx.set("Content-Type", "application/zip");
    ctx.set(
      "Content-Disposition",
      contentDisposition(`${fileName}.zip`, {
        type: "attachment",
      })
    );
    ctx.body = zip.generateNodeStream(ZipHelper.defaultStreamOptions);
  }
);

router.post(
  "documents.restore",
  auth({ role: UserRole.Editor }),
  validate(T.DocumentsRestoreSchema),
  transaction(),
  async (ctx: APIContext<T.DocumentsRestoreReq>) => {
    const { id, collectionId, revisionId } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;
    const document = await Document.findByPk(id, {
      userId: user.id,
      paranoid: false,
      rejectOnEmpty: true,
      transaction,
    });

    const sourceCollectionId = document.collectionId;
    const destCollectionId = collectionId ?? sourceCollectionId;

    const srcCollection = sourceCollectionId
      ? await Collection.findByPk(sourceCollectionId, {
          userId: user.id,
          includeDocumentStructure: true,
          paranoid: false,
          transaction,
        })
      : undefined;

    const destCollection = destCollectionId
      ? await Collection.findByPk(destCollectionId, {
          userId: user.id,
          includeDocumentStructure: true,
          transaction,
        })
      : undefined;

    if (!destCollection?.isActive) {
      throw ValidationError(
        "Unable to restore, the collection may have been deleted or archived"
      );
    }

    if (sourceCollectionId && sourceCollectionId !== destCollectionId) {
      authorize(user, "updateDocument", srcCollection);
      await srcCollection?.removeDocumentInStructure(document, {
        save: true,
        transaction,
      });
    }

    if (document.deletedAt) {
      authorize(user, "restore", document);
      authorize(user, "updateDocument", destCollection);

      // restore a previously deleted document
      await document.restoreTo(ctx, { collectionId: destCollectionId! }); // destCollectionId is guaranteed to be defined here
    } else if (document.archivedAt) {
      authorize(user, "unarchive", document);
      authorize(user, "updateDocument", destCollection);

      // restore a previously archived document
      await document.restoreTo(ctx, { collectionId: destCollectionId! }); // destCollectionId is guaranteed to be defined here
    } else if (revisionId) {
      // restore a document to a specific revision
      authorize(user, "update", document);
      const revision = await Revision.findByPk(revisionId, { transaction });
      authorize(document, "restore", revision);

      await document.restoreFromRevision(revision);
      await document.saveWithCtx(ctx, undefined, { name: "restore" });
    } else {
      assertPresent(revisionId, "revisionId is required");
    }

    ctx.body = {
      data: await presentDocument(ctx, document),
      policies: presentPolicies(user, [document]),
    };
  }
);

router.post(
  "documents.search_titles",
  auth(),
  pagination(),
  rateLimiter(RateLimiterStrategy.OneHundredPerMinute),
  validate(T.DocumentsSearchTitlesSchema),
  async (ctx: APIContext<T.DocumentsSearchTitlesReq>) => {
    const {
      query,
      statusFilter,
      dateFilter,
      collectionId,
      userId,
      sort,
      direction,
    } = ctx.input.body;
    const { offset, limit } = ctx.state.pagination;
    const { user } = ctx.state.auth;
    let collaboratorIds = undefined;

    if (collectionId) {
      const collection = await Collection.findByPk(collectionId, {
        userId: user.id,
      });
      authorize(user, "readDocument", collection);
    }

    if (userId) {
      collaboratorIds = [userId];
    }

    const documents = await SearchHelper.searchTitlesForUser(user, {
      query,
      dateFilter,
      statusFilter,
      collectionId,
      collaboratorIds,
      offset,
      limit,
      sort: sort as SortFilter,
      direction: direction as DirectionFilter,
    });
    const policies = presentPolicies(user, documents);
    const data = await Promise.all(
      documents.map((document) => presentDocument(ctx, document))
    );

    ctx.body = {
      pagination: ctx.state.pagination,
      data,
      policies,
    };
  }
);

router.post(
  "documents.search",
  auth({ optional: true }),
  pagination(),
  rateLimiter(RateLimiterStrategy.OneHundredPerMinute),
  validate(T.DocumentsSearchSchema),
  async (ctx: APIContext<T.DocumentsSearchReq>) => {
    const {
      query,
      collectionId,
      documentId,
      userId,
      dateFilter,
      statusFilter = [],
      shareId,
      snippetMinWords,
      snippetMaxWords,
      sort,
      direction,
    } = ctx.input.body;
    const { offset, limit } = ctx.state.pagination;
    const { user } = ctx.state.auth;

    let teamId;
    let response;
    let share;
    let isPublic = false;

    if (shareId) {
      const teamFromCtx = await getTeamFromContext(ctx, {
        includeStateCookie: false,
      });
      const result = await loadPublicShare({
        id: shareId,
        teamId: teamFromCtx?.id,
      });

      share = result.share;
      let { collection, document } = result; // One of collection or document should be available

      // reload with permission grant scope if user is authenticated
      if (user) {
        collection = collection
          ? await Collection.findByPk(collection.id, { userId: user.id })
          : null;
        document = document
          ? await Document.findByPk(document.id, { userId: user.id })
          : null;
      }

      isPublic = collection
        ? cannot(user, "read", collection)
        : cannot(user, "read", document);

      if (share.documentId && !share?.includeChildDocuments) {
        throw InvalidRequestError("Child documents cannot be searched");
      }

      teamId = share.teamId;
      const team = await share.$get("team");
      invariant(team, "Share must belong to a team");

      response = await SearchHelper.searchForTeam(team, {
        query,
        collectionId: collection?.id || document?.collectionId,
        share,
        dateFilter,
        statusFilter,
        offset,
        limit,
        snippetMinWords,
        snippetMaxWords,
        sort: sort as SortFilter,
        direction: direction as DirectionFilter,
      });
    } else {
      if (!user) {
        throw AuthenticationError("Authentication error");
      }

      teamId = user.teamId;

      if (collectionId) {
        const collection = await Collection.findByPk(collectionId, {
          userId: user.id,
        });
        authorize(user, "readDocument", collection);
      }

      let documentIds = undefined;
      if (documentId) {
        const document = await Document.findByPk(documentId, {
          userId: user.id,
        });
        authorize(user, "read", document);
        documentIds = [
          documentId,
          ...(await document.findAllChildDocumentIds()),
        ];
      }

      let collaboratorIds = undefined;

      if (userId) {
        collaboratorIds = [userId];
      }

      response = await SearchHelper.searchForUser(user, {
        query,
        collaboratorIds,
        collectionId,
        documentIds,
        dateFilter,
        statusFilter,
        offset,
        limit,
        snippetMinWords,
        snippetMaxWords,
        sort: sort as SortFilter,
        direction: direction as DirectionFilter,
      });
    }

    const { results, total } = response;
    const documents = results.map((result) => result.document);

    const data = await Promise.all(
      results.map(async (result) => {
        const document = await presentDocument(ctx, result.document, {
          isPublic,
          shareId,
        });
        return { ...result, document };
      })
    );

    // When requesting subsequent pages of search results we don't want to record
    // duplicate search query records
    if (query && offset === 0) {
      await SearchQuery.create({
        userId: user?.id,
        teamId,
        shareId: share?.id,
        source: ctx.state.auth.type || "app", // we'll consider anything that isn't "api" to be "app"
        query,
        results: total,
      });
    }

    ctx.body = {
      pagination: { ...ctx.state.pagination, total },
      data,
      policies: user ? presentPolicies(user, documents) : null,
    };
  }
);

router.post(
  "documents.templatize",
  auth({ role: UserRole.Editor }),
  rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
  validate(T.DocumentsTemplatizeSchema),
  transaction(),
  async (ctx: APIContext<T.DocumentsTemplatizeReq>) => {
    const { id, collectionId, publish } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const original = await Document.findByPk(id, {
      userId: user.id,
      transaction,
    });

    authorize(user, "update", original);

    if (collectionId) {
      const collection = await Collection.findByPk(collectionId, {
        userId: user.id,
        transaction,
      });
      authorize(user, "createDocument", collection);
    } else {
      authorize(user, "createTemplate", user.team);
    }

    const template = await Template.createWithCtx(ctx, {
      editorVersion: original.editorVersion,
      collectionId,
      teamId: user.teamId,
      publishedAt: publish ? new Date() : null,
      lastModifiedById: user.id,
      createdById: user.id,
      icon: original.icon,
      color: original.color,
      title: original.title,
      content: original.content,
    });

    // reload to get all of the data needed to present (user, collection etc)
    const reloaded = await Template.findByPk(template.id, {
      userId: user.id,
      transaction,
    });
    invariant(reloaded, "template not found");

    ctx.body = {
      data: presentTemplate(reloaded),
      policies: presentPolicies(user, [reloaded]),
    };
  }
);

router.post(
  "documents.update",
  auth(),
  validate(T.DocumentsUpdateSchema),
  transaction(),
  async (ctx: APIContext<T.DocumentsUpdateReq>) => {
    const { transaction } = ctx.state;
    const { id, insightsEnabled, publish, collectionId, ...input } =
      ctx.input.body;
    const editorVersion = ctx.headers["x-editor-version"] as string | undefined;

    const { user } = ctx.state.auth;
    let collection: Collection | null | undefined;

    let document = await Document.findByPk(id, {
      userId: user.id,
      includeState: true,
      transaction,
    });
    collection = document?.collection;
    authorize(user, "update", document);

    if (collection && insightsEnabled !== undefined) {
      authorize(user, "updateInsights", document);
    }

    if (publish) {
      if (document.isDraft) {
        authorize(user, "publish", document);
      }

      if (!document.collectionId) {
        assertPresent(
          collectionId,
          "collectionId is required to publish a draft without collection"
        );
        collection = await Collection.findByPk(collectionId!, {
          userId: user.id,
          transaction,
        });
      }

      if (document.parentDocumentId) {
        const parentDocument = await Document.findByPk(
          document.parentDocumentId,
          {
            userId: user.id,
            transaction,
          }
        );
        authorize(user, "createChildDocument", parentDocument, { collection });
      } else {
        authorize(user, "createDocument", collection);
      }
    }

    document = await documentUpdater(ctx, {
      document,
      ...input,
      publish,
      collectionId,
      insightsEnabled,
      editorVersion,
    });

    ctx.body = {
      data: await presentDocument(ctx, document),
      policies: presentPolicies(user, [document]),
    };
  }
);

router.post(
  "documents.duplicate",
  auth(),
  validate(T.DocumentsDuplicateSchema),
  transaction(),
  async (ctx: APIContext<T.DocumentsDuplicateReq>) => {
    const { transaction } = ctx.state;
    const { id, title, publish, recursive, collectionId, parentDocumentId } =
      ctx.input.body;
    const { user } = ctx.state.auth;

    const document = await Document.findByPk(id, {
      userId: user.id,
      transaction,
    });
    authorize(user, "read", document);

    const collection = collectionId
      ? await Collection.findByPk(collectionId, {
          userId: user.id,
          transaction,
        })
      : document?.collection;

    if (collection) {
      authorize(user, "updateDocument", collection);
    }

    if (parentDocumentId) {
      const parent = await Document.findByPk(parentDocumentId, {
        userId: user.id,
        transaction,
      });
      authorize(user, "update", parent);

      if (!parent.publishedAt) {
        throw InvalidRequestError("Cannot duplicate document inside a draft");
      }
    }

    const response = await documentDuplicator(ctx, {
      collection,
      document,
      title,
      publish,
      recursive,
      parentDocumentId,
    });

    ctx.body = {
      data: {
        documents: await Promise.all(
          response.map((document) => presentDocument(ctx, document))
        ),
      },
      policies: presentPolicies(user, response),
    };
  }
);

router.post(
  "documents.move",
  auth(),
  validate(T.DocumentsMoveSchema),
  transaction(),
  async (ctx: APIContext<T.DocumentsMoveReq>) => {
    const { transaction } = ctx.state;
    const { id, parentDocumentId, index } = ctx.input.body;
    let collectionId = ctx.input.body.collectionId;
    const { user } = ctx.state.auth;
    const document = await Document.findByPk(id, {
      userId: user.id,
      transaction,
    });
    authorize(user, "move", document);

    if (parentDocumentId) {
      const parent = await Document.findByPk(parentDocumentId, {
        userId: user.id,
        transaction,
      });
      authorize(user, "update", parent);
      collectionId = parent.collectionId;

      if (!parent.publishedAt) {
        throw InvalidRequestError("Cannot move document inside a draft");
      }
    } else if (collectionId) {
      const collection = await Collection.findByPk(collectionId, {
        userId: user.id,
        transaction,
      });
      authorize(user, "updateDocument", collection);
    } else {
      throw InvalidRequestError("collectionId is required to move a document");
    }

    const { documents, collectionChanged } = await documentMover(ctx, {
      document,
      collectionId: collectionId ?? null,
      parentDocumentId,
      index,
    });

    ctx.body = {
      data: {
        documents: await Promise.all(
          documents.map((doc) => presentDocument(ctx, doc))
        ),
        // Included for backwards compatibility
        collections: [],
      },
      policies: collectionChanged ? presentPolicies(user, documents) : [],
    };
  }
);

router.post(
  "documents.archive",
  auth(),
  validate(T.DocumentsArchiveSchema),
  transaction(),
  async (ctx: APIContext<T.DocumentsArchiveReq>) => {
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;
    const { transaction } = ctx.state;

    const document = await Document.findByPk(id, {
      userId: user.id,
      rejectOnEmpty: true,
      transaction,
    });
    authorize(user, "archive", document);

    await document.archiveWithCtx(ctx);

    ctx.body = {
      data: await presentDocument(ctx, document),
      policies: presentPolicies(user, [document]),
    };
  }
);

router.post(
  "documents.delete",
  auth(),
  validate(T.DocumentsDeleteSchema),
  async (ctx: APIContext<T.DocumentsDeleteReq>) => {
    const { id, permanent } = ctx.input.body;
    const { user } = ctx.state.auth;

    if (permanent) {
      const document = await Document.findByPk(id, {
        userId: user.id,
        paranoid: false,
      });
      authorize(user, "permanentDelete", document);

      await documentPermanentDeleter([document]);
      await Event.createFromContext(ctx, {
        name: "documents.permanent_delete",
        documentId: document.id,
        collectionId: document.collectionId,
        data: {
          title: document.title,
        },
      });
    } else {
      const document = await Document.findByPk(id, {
        userId: user.id,
      });

      authorize(user, "delete", document);

      await document.delete(user);
    }

    ctx.body = {
      success: true,
    };
  }
);

router.post(
  "documents.unpublish",
  auth(),
  validate(T.DocumentsUnpublishSchema),
  transaction(),
  async (ctx: APIContext<T.DocumentsUnpublishReq>) => {
    const { id, detach } = ctx.input.body;
    const { user } = ctx.state.auth;

    const document = await Document.findByPk(id, {
      userId: user.id,
    });
    authorize(user, "unpublish", document);

    await document.unpublishWithCtx(ctx, { detach });

    ctx.body = {
      data: await presentDocument(ctx, document),
      policies: presentPolicies(user, [document]),
    };
  }
);

router.post(
  "documents.import",
  auth(),
  rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
  multipart({
    maximumFileSize: env.FILE_STORAGE_IMPORT_MAX_SIZE,
    optional: true,
  }),
  validate(T.DocumentsImportSchema),
  async (ctx: APIContext<T.DocumentsImportReq>) => {
    const { collectionId, parentDocumentId, publish, attachmentId } =
      ctx.input.body;
    const { user } = ctx.state.auth;

    if (!attachmentId && !ctx.input.file) {
      throw ValidationError("one of attachmentId or file is required");
    }

    if (collectionId) {
      const collection = await Collection.findByPk(collectionId, {
        userId: user.id,
      });
      authorize(user, "createDocument", collection);
    }

    let parentDocument: Document | null = null;

    if (parentDocumentId) {
      parentDocument = await Document.findByPk(parentDocumentId, {
        userId: user.id,
      });
      authorize(user, "createChildDocument", parentDocument);
    }

    let key: string;
    let fileName: string;
    let mimeType: string;

    if (attachmentId) {
      const attachment = await Attachment.findByPk(attachmentId);
      authorize(user, "read", attachment);

      key = attachment.key;
      fileName = attachment.name;
      mimeType = attachment.contentType;
    } else {
      const file = ctx.input.file!;
      const buffer = await fs.readFile(file.filepath);
      fileName = file.originalFilename ?? file.newFilename;
      mimeType = file.mimetype ?? "";

      key = AttachmentHelper.getKey({
        id: randomUUID(),
        name: fileName,
        userId: user.id,
      });

      await FileStorage.store({
        body: buffer,
        contentType: mimeType,
        contentLength: buffer.length,
        key,
        acl: "private",
      });
    }

    const job = await new DocumentImportTask().schedule({
      key,
      sourceMetadata: {
        fileName,
        mimeType,
      },
      userId: user.id,
      collectionId: collectionId ?? parentDocument?.collectionId,
      parentDocumentId,
      publish,
      ip: ctx.request.ip,
    });
    const response: DocumentImportTaskResponse = await job.finished();
    if ("error" in response) {
      throw InvalidRequestError(response.error);
    }

    const document = await Document.findByPk(response.documentId, {
      userId: user.id,
      rejectOnEmpty: true,
    });

    ctx.body = {
      data: await presentDocument(ctx, document),
      policies: presentPolicies(user, [document]),
    };
  }
);

router.post(
  "documents.create",
  auth(),
  rateLimiter(RateLimiterStrategy.TwentyFivePerMinute),
  validate(T.DocumentsCreateSchema),
  transaction(),
  async (ctx: APIContext<T.DocumentsCreateReq>) => {
    const {
      id,
      title,
      text,
      icon,
      color,
      publish,
      index,
      collectionId,
      parentDocumentId,
      fullWidth,
      templateId,
      createdAt,
    } = ctx.input.body;
    const editorVersion = ctx.headers["x-editor-version"] as string | undefined;

    const { transaction } = ctx.state;
    const { user } = ctx.state.auth;

    let collection;

    let parentDocument;

    if (parentDocumentId) {
      parentDocument = await Document.findByPk(parentDocumentId, {
        userId: user.id,
      });

      if (parentDocument?.collectionId) {
        collection = await Collection.findByPk(parentDocument.collectionId, {
          userId: user.id,
        });
      }

      authorize(user, "createChildDocument", parentDocument, {
        collection,
      });
    } else if (collectionId) {
      collection = await Collection.findByPk(collectionId, {
        userId: user.id,
        transaction,
      });
      authorize(user, "createDocument", collection);
    }

    let template: Template | null | undefined;

    if (templateId) {
      template = await Template.findByPk(templateId, {
        userId: user.id,
        transaction,
      });
      authorize(user, "read", template);
    }

    // Pre-process text to convert bare embed URLs to markdown link format
    const processedText = text ? convertBareUrlsToEmbedMarkdown(text) : text;

    const document = await documentCreator(ctx, {
      id,
      title,
      text: processedText
        ? await TextHelper.replaceImagesWithAttachments(
            ctx,
            processedText,
            user
          )
        : processedText,
      icon,
      color,
      createdAt,
      publish,
      index,
      collectionId: collection?.id,
      parentDocumentId,
      template,
      fullWidth,
      editorVersion,
    });

    if (collection) {
      document.collection = collection;
    }

    ctx.body = {
      data: await presentDocument(ctx, document),
      policies: presentPolicies(user, [document]),
    };
  }
);

router.post(
  "documents.add_user",
  auth(),
  validate(T.DocumentsAddUserSchema),
  rateLimiter(RateLimiterStrategy.OneHundredPerHour),
  transaction(),
  async (ctx: APIContext<T.DocumentsAddUserReq>) => {
    const { transaction } = ctx.state;
    const { user: actor } = ctx.state.auth;
    const { id, userId, permission } = ctx.input.body;

    if (userId === actor.id) {
      throw ValidationError("You cannot invite yourself");
    }

    const [document, user] = await Promise.all([
      Document.findByPk(id, {
        userId: actor.id,
        rejectOnEmpty: true,
        transaction,
      }),
      User.findByPk(userId, {
        rejectOnEmpty: true,
        transaction,
      }),
    ]);

    authorize(actor, "manageUsers", document);
    authorize(actor, "read", user);

    const resolvedPermission = permission || user.defaultDocumentPermission;

    await Permission.destroy({
      where: {
        teamId: actor.teamId,
        subjectType: PermissionSubjectType.User,
        subjectId: userId,
        resourceType: PermissionResourceType.Document,
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
        resourceType: PermissionResourceType.Document,
        resourceId: id,
        permission: documentPermissionToLevel(resolvedPermission),
        inheritMode: PermissionInheritMode.Self,
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
            documentId: id,
            collectionId: null,
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
  "documents.remove_user",
  auth(),
  validate(T.DocumentsRemoveUserSchema),
  transaction(),
  async (ctx: APIContext<T.DocumentsRemoveUserReq>) => {
    const { transaction } = ctx.state;
    const { user: actor } = ctx.state.auth;
    const { id, userId } = ctx.input.body;

    const [document, user] = await Promise.all([
      Document.findByPk(id, {
        userId: actor.id,
        rejectOnEmpty: true,
        transaction,
      }),
      User.findByPk(userId, {
        rejectOnEmpty: true,
        transaction,
      }),
    ]);

    if (actor.id !== userId) {
      authorize(actor, "manageUsers", document);
      authorize(actor, "read", user);
    }

    const grant = await Permission.findOne({
      where: {
        teamId: actor.teamId,
        subjectType: PermissionSubjectType.User,
        subjectId: userId,
        resourceType: PermissionResourceType.Document,
        resourceId: id,
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
      rejectOnEmpty: true,
    });

    await grant.destroy(ctx.context);

    await Permission.destroy({
      where: {
        teamId: actor.teamId,
        subjectType: PermissionSubjectType.User,
        subjectId: userId,
        resourceType: PermissionResourceType.Document,
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
  "documents.add_group",
  auth(),
  validate(T.DocumentsAddGroupSchema),
  transaction(),
  async (ctx: APIContext<T.DocumentsAddGroupsReq>) => {
    const { id, groupId, permission } = ctx.input.body;
    const { transaction } = ctx.state;
    const { user } = ctx.state.auth;

    const [document, group] = await Promise.all([
      Document.findByPk(id, {
        userId: user.id,
        rejectOnEmpty: true,
        transaction,
      }),
      Group.findByPk(groupId, {
        rejectOnEmpty: true,
        transaction,
      }),
    ]);
    authorize(user, "manageUsers", document);
    authorize(user, "read", group);

    const resolvedPermission = permission || user.defaultDocumentPermission;

    await Permission.destroy({
      where: {
        teamId: user.teamId,
        subjectType: PermissionSubjectType.Group,
        subjectId: groupId,
        resourceType: PermissionResourceType.Document,
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
        resourceType: PermissionResourceType.Document,
        resourceId: id,
        permission: documentPermissionToLevel(resolvedPermission),
        inheritMode: PermissionInheritMode.Self,
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
            documentId: id,
            collectionId: null,
            permission: resolvedPermission,
            sourceId: null,
          },
        ],
      },
    };
  }
);

router.post(
  "documents.remove_group",
  auth(),
  validate(T.DocumentsRemoveGroupSchema),
  transaction(),
  async (ctx: APIContext<T.DocumentsRemoveGroupReq>) => {
    const { transaction } = ctx.state;
    const { user } = ctx.state.auth;
    const { id, groupId } = ctx.input.body;

    const [document, group] = await Promise.all([
      Document.findByPk(id, {
        userId: user.id,
        rejectOnEmpty: true,
        transaction,
      }),
      Group.findByPk(groupId, {
        rejectOnEmpty: true,
        transaction,
      }),
    ]);
    authorize(user, "manageUsers", document);
    authorize(user, "read", group);

    const grant = await Permission.findOne({
      where: {
        teamId: user.teamId,
        subjectType: PermissionSubjectType.Group,
        subjectId: groupId,
        resourceType: PermissionResourceType.Document,
        resourceId: id,
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
      rejectOnEmpty: true,
    });

    await grant.destroy(ctx.context);

    await Permission.destroy({
      where: {
        teamId: user.teamId,
        subjectType: PermissionSubjectType.Group,
        subjectId: groupId,
        resourceType: PermissionResourceType.Document,
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
  "documents.memberships",
  auth(),
  pagination(),
  validate(T.DocumentsMembershipsSchema),
  async (ctx: APIContext<T.DocumentsMembershipsReq>) => {
    const { id, query, permission } = ctx.input.body;
    const { user: actor } = ctx.state.auth;

    const document = await Document.findByPk(id, { userId: actor.id });
    authorize(actor, "update", document);

    let where: WhereOptions<Permission> = {
      teamId: actor.teamId,
      subjectType: PermissionSubjectType.User,
      resourceType: PermissionResourceType.Document,
      resourceId: id,
      deletedAt: null,
    };
    const filteredUserIds = query
      ? (
          await User.findAll({
            where: {
              teamId: actor.teamId,
              name: { [Op.iLike]: `%${query}%` },
            },
            attributes: ["id"],
          })
        ).map((subjectUser) => subjectUser.id)
      : null;

    if (permission) {
      where = {
        ...where,
        permission: documentPermissionToLevel(permission),
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
            teamId: actor.teamId,
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
          documentId: membership.resourceId,
          collectionId: null,
          permission: levelToDocumentPermission(membership.permission),
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
  "documents.group_memberships",
  auth(),
  pagination(),
  validate(T.DocumentsMembershipsSchema),
  async (ctx: APIContext<T.DocumentsMembershipsReq>) => {
    const { id, query, permission } = ctx.input.body;
    const { user } = ctx.state.auth;

    const document = await Document.findByPk(id, { userId: user.id });
    authorize(user, "update", document);

    let where: WhereOptions<Permission> = {
      teamId: user.teamId,
      subjectType: PermissionSubjectType.Group,
      resourceType: PermissionResourceType.Document,
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
        permission: documentPermissionToLevel(permission),
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
    const groupsById = new Map(groups.map((group) => [group.id, group]));
    const visibleMemberships = memberships.filter((membership) =>
      groupsById.has(membership.subjectId ?? "")
    );
    const groupMemberships = visibleMemberships.map((membership) => ({
      id: membership.id,
      groupId: membership.subjectId!,
      documentId: membership.resourceId,
      collectionId: null,
      permission: levelToDocumentPermission(membership.permission),
      sourceId: null,
    }));

    ctx.body = {
      pagination: { ...ctx.state.pagination, total },
      data: {
        groupMemberships,
        groups: await Promise.all(
          visibleMemberships.map((membership) =>
            presentGroup(groupsById.get(membership.subjectId!)!)
          )
        ),
      },
    };
  }
);

router.post(
  "documents.empty_trash",
  auth({ role: UserRole.Admin }),
  async (ctx: APIContext) => {
    const { user } = ctx.state.auth;

    const collectionIds = await user.collectionIds({
      paranoid: false,
    });
    const documents = await Document.scope("withDrafts").findAll({
      attributes: ["id"],
      where: {
        deletedAt: {
          [Op.ne]: null,
        },
        [Op.or]: [
          {
            collectionId: {
              [Op.in]: collectionIds,
            },
          },
          {
            createdById: user.id,
            collectionId: {
              [Op.is]: null,
            },
          },
        ],
      },
      paranoid: false,
    });

    if (documents.length) {
      await new EmptyTrashTask().schedule({
        documentIds: documents.map((doc) => doc.id),
      });
    }

    await Event.createFromContext(ctx, {
      name: "documents.empty_trash",
    });

    ctx.body = {
      success: true,
    };
  }
);

// Remove this helper once apiVersion is removed (#6175)
function getAPIVersion(ctx: APIContext) {
  return Number(
    ctx.headers["x-api-version"] ??
      (typeof ctx.input.body === "object" &&
        ctx.input.body &&
        "apiVersion" in ctx.input.body &&
        ctx.input.body.apiVersion) ??
      0
  );
}

export default router;
