import Router from "koa-router";
import { Op } from "sequelize";
import auth from "@server/middlewares/authentication";
import { transaction } from "@server/middlewares/transaction";
import validate from "@server/middlewares/validate";
import { Document, Event, Permission } from "@server/models";
import {
  PermissionLevel,
  PermissionResourceType,
  PermissionSubjectType,
} from "@server/models/Permission";
import { authorize } from "@server/policies";
import {
  presentDocument,
  presentPolicies,
} from "@server/presenters";
import type { APIContext } from "@server/types";
import { assertPresent } from "@server/validation";
import pagination from "../middlewares/pagination";
import * as T from "./schema";

const router = new Router();

const levelToDocumentPermission = (level: PermissionLevel) =>
  level === PermissionLevel.Manage
    ? "manage"
    : level === PermissionLevel.Edit
      ? "edit"
      : "read";

router.post(
  "userMemberships.list",
  auth(),
  pagination(),
  validate(T.UserMembershipsListSchema),
  async (ctx: APIContext<T.UserMembershipsListReq>) => {
    const { user } = ctx.state.auth;

    const memberships = await Permission.findAll({
      where: {
        teamId: user.teamId,
        subjectType: PermissionSubjectType.User,
        subjectId: user.id,
        resourceType: PermissionResourceType.Document,
        resourceId: {
          [Op.ne]: null,
        },
        deletedAt: null,
      },
      order: [["updatedAt", "DESC"]],
      offset: ctx.state.pagination.offset,
      limit: ctx.state.pagination.limit,
    });

    const documentIds = memberships
      .map((p) => p.resourceId)
      .filter(Boolean) as string[];
    const documents = await Document.findByIds(documentIds, {
      userId: user.id,
    });
    const visibleDocumentIds = new Set(documents.map((document) => document.id));
    const visibleMemberships = memberships.filter(
      (membership) =>
        !!membership.resourceId && visibleDocumentIds.has(membership.resourceId)
    );

    const policies = presentPolicies(user, documents);

    ctx.body = {
      pagination: ctx.state.pagination,
      data: {
        memberships: visibleMemberships.map((membership) => ({
          id: membership.id,
          userId: membership.subjectId,
          documentId: membership.resourceId,
          collectionId: null,
          permission: levelToDocumentPermission(membership.permission),
          createdById: membership.grantedById,
          sourceId: null,
          index: null,
        })),
        documents: await Promise.all(
          documents.map((document: Document) => presentDocument(ctx, document))
        ),
      },
      policies,
    };
  }
);

router.post(
  "userMemberships.update",
  auth(),
  validate(T.UserMembershipsUpdateSchema),
  transaction(),
  async (ctx: APIContext<T.UserMembershipsUpdateReq>) => {
    const { id, index } = ctx.input.body;
    const { transaction } = ctx.state;

    const { user } = ctx.state.auth;
    const membership = await Permission.findByPk(id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
      rejectOnEmpty: true,
    });
    assertPresent(membership.resourceId, "document permission is invalid");
    const documentId = membership.resourceId as string;
    const document = await Document.findByPk(documentId, {
      userId: user.id,
      transaction,
      rejectOnEmpty: true,
    });
    authorize(user, "read", document);
    if (membership.subjectId !== user.id) {
      ctx.throw(403, "You are not authorized to modify this membership");
    }

    await Event.createFromContext(ctx, {
      name: "userMemberships.update",
      modelId: membership.id,
      userId: membership.subjectId!,
      documentId,
      data: {
        index,
      },
    });

    ctx.body = {
      data: {
        id: membership.id,
        userId: membership.subjectId,
        documentId,
        collectionId: null,
        permission: levelToDocumentPermission(membership.permission),
        createdById: membership.grantedById,
        sourceId: null,
        index,
      },
      policies: presentPolicies(user, [document]),
    };
  }
);

export default router;
