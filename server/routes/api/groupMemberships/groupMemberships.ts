import Router from "koa-router";
import uniqBy from "lodash/uniqBy";
import { Op } from "sequelize";
import { DocumentPermission } from "@shared/types";
import auth from "@server/middlewares/authentication";
import validate from "@server/middlewares/validate";
import { Document, Group, Permission } from "@server/models";
import {
  PermissionLevel,
  PermissionResourceType,
  PermissionSubjectType,
} from "@server/models/Permission";
import {
  presentDocument,
  presentGroup,
  presentPolicies,
} from "@server/presenters";
import type { APIContext } from "@server/types";
import pagination from "../middlewares/pagination";
import * as T from "./schema";

const router = new Router();
const levelToDocumentPermission = (level: PermissionLevel) =>
  level === PermissionLevel.Manage
    ? DocumentPermission.Manage
    : level === PermissionLevel.Edit
      ? DocumentPermission.Edit
      : DocumentPermission.Read;

router.post(
  "groupMemberships.list",
  auth(),
  pagination(),
  validate(T.GroupMembershipsListSchema),
  async (ctx: APIContext<T.GroupMembershipsListReq>) => {
    const { groupId } = ctx.input.body;
    const { user } = ctx.state.auth;
    const memberGroups = await Group.filterByMember(user.id).findAll({
      attributes: ["id"],
    });
    const memberGroupIds = memberGroups.map((group) => group.id);

    if (!memberGroupIds.length) {
      ctx.body = {
        pagination: { ...ctx.state.pagination, total: 0 },
        data: {
          groups: [],
          groupMemberships: [],
          documents: [],
        },
        policies: {},
      };
      return;
    }

    const targetGroupIds = groupId ? [groupId] : memberGroupIds;
    const allowedGroupIds = targetGroupIds.filter((id) =>
      memberGroupIds.includes(id)
    );

    if (!allowedGroupIds.length) {
      ctx.body = {
        pagination: { ...ctx.state.pagination, total: 0 },
        data: {
          groups: [],
          groupMemberships: [],
          documents: [],
        },
        policies: {},
      };
      return;
    }

    const where = {
      teamId: user.teamId,
      subjectType: PermissionSubjectType.Group,
      resourceType: PermissionResourceType.Document,
      deletedAt: null,
      subjectId: {
        [Op.in]: allowedGroupIds,
      },
    };

    const memberships = await Permission.findAll({
      where,
      order: [["createdAt", "DESC"]],
      offset: ctx.state.pagination.offset,
      limit: ctx.state.pagination.limit,
    });

    const documentIds = memberships
      .map((membership) => membership.resourceId)
      .filter(Boolean) as string[];
    const [documents, groups] = await Promise.all([
      Document.withPermissionScope(user.id, {
        includeDrafts: true,
      }).findAll({
        where: {
          id: documentIds,
        },
      }),
      Group.findAll({
        where: {
          id: memberships
            .map((membership) => membership.subjectId)
            .filter(Boolean) as string[],
          teamId: user.teamId,
        },
      }),
    ]);
    const groupsById = new Map(groups.map((group) => [group.id, group]));

    const membershipPayload = memberships
      .filter((membership) => groupsById.has(membership.subjectId ?? ""))
      .map((membership) => ({
        id: membership.id,
        groupId: membership.subjectId!,
        documentId: membership.resourceId!,
        collectionId: null,
        permission: levelToDocumentPermission(membership.permission),
        sourceId: null,
      }));

    const visibleDocumentIds = new Set(documents.map((document) => document.id));
    const filteredMemberships = membershipPayload.filter((membership) =>
      visibleDocumentIds.has(membership.documentId)
    );

    const filteredGroups = uniqBy(
      filteredMemberships
        .map((membership) => groupsById.get(membership.groupId))
        .filter(Boolean),
      "id"
    ) as Group[];

    const policies = presentPolicies(user, [
      ...documents,
      ...filteredGroups,
    ]);

    ctx.body = {
      pagination: { ...ctx.state.pagination, total: filteredMemberships.length },
      data: {
        groups: await Promise.all(filteredGroups.map(presentGroup)),
        groupMemberships: filteredMemberships,
        documents: await Promise.all(
          documents.map((document: Document) => presentDocument(ctx, document))
        ),
      },
      policies,
    };
  }
);

export default router;
