import invariant from "invariant";
import { DocumentPermission, TeamPreference } from "@shared/types";
import { Document, Revision, User, Team } from "@server/models";
import type { Permission } from "@server/models";
import {
  PermissionLevel,
  PermissionSubjectType,
} from "@server/models/Permission";
import { allow, cannot, can } from "./cancan";
import { and, isTeamAdmin, isTeamModel, isTeamMutable, or } from "./utils";

allow(User, "createDocument", Team, (actor, document) =>
  and(
    !actor.isViewer,
    isTeamModel(actor, document),
    isTeamMutable(actor)
  )
);

allow(User, "read", Document, (actor, document) =>
  and(
    isTeamModel(actor, document),
    or(
      includesPermission(document, actor, [
        DocumentPermission.Read,
        DocumentPermission.Edit,
        DocumentPermission.Manage,
      ]),
      and(!!document?.isDraft, actor.id === document?.createdById),
      can(actor, "readDocument", document?.collection)
    )
  )
);

allow(User, ["listRevisions", "listViews"], Document, (actor, document) =>
  can(actor, "read", document)
);

allow(User, "download", Document, (actor, document) =>
  and(
    can(actor, "read", document),
    or(
      !actor.isViewer,
      !!actor.team.getPreference(TeamPreference.ViewersCanExport)
    )
  )
);

allow(User, "comment", Document, (actor, document) =>
  and(
    !!document?.isActive,
    isTeamMutable(actor),
    // TODO: We'll introduce a separate permission for commenting
    can(actor, "read", document),
    or(!document?.collection, document?.collection?.commenting !== false)
  )
);

allow(
  User,
  ["star", "unstar", "subscribe", "unsubscribe"],
  Document,
  (actor, document) =>
    and(
      //
      can(actor, "read", document)
    )
);

allow(User, "share", Document, (actor, document) =>
  and(
    !!document?.isActive,
    !actor.isViewer,
    isTeamMutable(actor),
    can(actor, "manageUsers", document),
    or(!document?.collection, document?.collection?.sharing !== false)
  )
);

allow(User, "update", Document, (actor, document) =>
  and(
    !!document?.isActive,
    isTeamMutable(actor),
    can(actor, "read", document),
    or(
      includesPermission(document, actor, [
        DocumentPermission.Edit,
        DocumentPermission.Manage,
      ]),
      or(
        can(actor, "updateDocument", document?.collection),
        and(!!document?.isDraft && actor.id === document?.createdById)
      )
    )
  )
);

allow(User, "publish", Document, (actor, document) =>
  and(
    //
    !!document?.isDraft,
    can(actor, "update", document)
  )
);

allow(User, "manageUsers", Document, (actor, document) =>
  and(
    can(actor, "update", document),
    or(
      includesPermission(document, actor, [DocumentPermission.Manage]),
      can(actor, "deleteDocument", document?.collection),
      !!document?.isDraft && actor.id === document?.createdById
    )
  )
);

allow(User, "duplicate", Document, (actor, document) =>
  and(
    can(actor, "update", document),
    or(
      includesPermission(document, actor, [DocumentPermission.Manage]),
      can(actor, "deleteDocument", document?.collection),
      !!document?.isDraft && actor.id === document?.createdById
    )
  )
);

allow(User, "move", Document, (actor, document) =>
  and(
    can(actor, "update", document),
    or(
      includesPermission(document, actor, [
        DocumentPermission.Edit,
        DocumentPermission.Manage,
      ]),
      can(actor, "updateDocument", document?.collection),
      and(!!document?.isDraft && actor.id === document?.createdById),
      and(!!document?.isDraft && !document?.collection)
    )
  )
);

allow(User, "createChildDocument", Document, (actor, document) =>
  and(
    //
    !document?.isDraft,
    can(actor, "update", document)
  )
);

allow(User, ["updateInsights", "pin", "unpin"], Document, (actor, document) =>
  and(
    !document?.isDraft,
    !actor.isViewer,
    can(actor, "update", document),
    can(actor, "update", document?.collection)
  )
);

allow(User, "pinToHome", Document, (actor, document) =>
  and(
    //
    !document?.isDraft,
    !!document?.isActive,
    isTeamModel(actor, document),
    isTeamMutable(actor),
    or(
      includesPermission(document, actor, [DocumentPermission.Manage]),
      can(actor, "deleteDocument", document?.collection)
    )
  )
);

allow(User, "delete", Document, (actor, document) =>
  and(
    !document?.isDeleted,
    isTeamModel(actor, document),
    isTeamMutable(actor),
    or(
      can(actor, "deleteDocument", document?.collection),
      includesPermission(document, actor, [DocumentPermission.Manage]),
      and(!document?.collection, actor.id === document?.createdById)
    )
  )
);

allow(User, "restore", Document, (actor, document) =>
  and(
    !actor.isViewer,
    !!document?.isDeleted,
    isTeamModel(actor, document),
    or(
      includesPermission(document, actor, [
        DocumentPermission.Edit,
        DocumentPermission.Manage,
      ]),
      can(actor, "updateDocument", document?.collection),
      and(!!document?.isDraft && actor.id === document?.createdById)
    )
  )
);

allow(User, "permanentDelete", Document, (actor, document) =>
  and(
    !actor.isViewer,
    !!document?.isDeleted,
    isTeamModel(actor, document),
    isTeamAdmin(actor, document)
  )
);

allow(User, "archive", Document, (actor, document) =>
  and(
    !document?.isDraft,
    !!document?.isActive,
    can(actor, "update", document),
    or(
      includesPermission(document, actor, [DocumentPermission.Manage]),
      can(actor, "deleteDocument", document?.collection)
    )
  )
);

allow(User, "unarchive", Document, (actor, document) =>
  and(
    !document?.isDraft,
    !document?.isDeleted,
    !!document?.archivedAt,
    can(actor, "read", document),
    or(
      includesPermission(document, actor, [
        DocumentPermission.Edit,
        DocumentPermission.Manage,
      ]),
      can(actor, "updateDocument", document?.collection),
      and(!!document?.isDraft && actor.id === document?.createdById)
    )
  )
);

allow(
  Document,
  "restore",
  Revision,
  (document, revision) => document.id === revision?.documentId
);

allow(User, "unpublish", Document, (user, document) => {
  if (
    !document ||
    user.isViewer ||
    !document.isActive ||
    document.isDraft
  ) {
    return false;
  }

  invariant(
    document.collection,
    "collection is missing, did you forget to include in the query scope?"
  );
  if (cannot(user, "updateDocument", document.collection)) {
    return false;
  }
  return user.teamId === document.teamId;
});

function includesPermission(
  document: Document | null,
  user: User,
  permissions: DocumentPermission[]
) {
  if (!document) {
    return false;
  }

  const permissionSet = new Set(permissions);
  const grantIds: string[] = [];

  const grants = document.permissionGrants ?? [];
  for (const grant of grants as Permission[]) {
    if (!matchesSubject(grant, user)) {
      continue;
    }

    const mapped =
      grant.permission === PermissionLevel.Manage
        ? DocumentPermission.Manage
        : grant.permission === PermissionLevel.Edit
          ? DocumentPermission.Edit
          : DocumentPermission.Read;

    if (permissionSet.has(mapped)) {
      grantIds.push(grant.id);
    }
  }

  return grantIds.length > 0 ? grantIds : false;
}

function matchesSubject(grant: Permission, user: User) {
  if (grant.subjectType === PermissionSubjectType.User) {
    return grant.subjectId === user.id;
  }

  if (grant.subjectType === PermissionSubjectType.Role) {
    return grant.subjectRole === user.role;
  }

  // Group grants are pre-filtered by Document.withPermissionGrants(userId)
  return grant.subjectType === PermissionSubjectType.Group;
}
