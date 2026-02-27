import { CollectionPermission } from "@shared/types";
import { Collection, User, Team } from "@server/models";
import type { Permission } from "@server/models";
import {
  PermissionLevel,
  PermissionSubjectType,
} from "@server/models/Permission";
import { allow } from "./cancan";
import { and, isTeamManager, isTeamModel, isTeamMutable, or } from "./utils";

allow(User, "createCollection", Team, (actor, team) =>
  and(
    !actor.isViewer,
    isTeamModel(actor, team),
    isTeamMutable(actor),
    or(actor.isAdmin, !!team?.memberCollectionCreate)
  )
);

allow(User, "importCollection", Team, (actor, team) =>
  and(
    //
    isTeamManager(actor, team),
    isTeamMutable(actor)
  )
);

allow(User, "move", Collection, (actor, collection) =>
  and(
    //
    !!collection?.isActive,
    isTeamModel(actor, collection),
    isTeamMutable(actor),
    includesPermission(collection, actor, [CollectionPermission.Manage])
  )
);

allow(User, "read", Collection, (user, collection) => {
  if (!collection || user.teamId !== collection.teamId) {
    return false;
  }

  return includesPermission(collection, user, Object.values(CollectionPermission));
});

allow(
  User,
  ["readDocument", "star", "unstar", "subscribe", "unsubscribe"],
  Collection,
  (user, collection) => {
    if (!collection || user.teamId !== collection.teamId) {
      return false;
    }

    return includesPermission(
      collection,
      user,
      Object.values(CollectionPermission)
    );
  }
);

allow(User, "share", Collection, (user, collection) => {
  if (
    !collection ||
    user.isViewer ||
    user.teamId !== collection.teamId ||
    !isTeamMutable(user)
  ) {
    return false;
  }
  if (!collection.sharing) {
    return false;
  }

  return includesPermission(collection, user, [
    CollectionPermission.Manage,
  ]);
});

allow(User, "updateDocument", Collection, (user, collection) => {
  if (!collection || !isTeamModel(user, collection) || !isTeamMutable(user)) {
    return false;
  }

  return includesPermission(collection, user, [
    CollectionPermission.Edit,
    CollectionPermission.Manage,
  ]);
});

allow(
  User,
  "createDocument",
  Collection,
  (user, collection) => {
    if (
      !collection ||
      !collection.isActive ||
      !isTeamModel(user, collection) ||
      !isTeamMutable(user)
    ) {
      return false;
    }

    return includesPermission(collection, user, [
      CollectionPermission.Edit,
      CollectionPermission.Manage,
    ]);
  }
);

allow(User, "deleteDocument", Collection, (user, collection) => {
  if (
    !collection ||
    !collection.isActive ||
      !isTeamModel(user, collection) ||
      !isTeamMutable(user)
    ) {
      return false;
    }

    return includesPermission(collection, user, [CollectionPermission.Manage]);
});

allow(User, ["update", "export", "archive"], Collection, (user, collection) =>
  and(
    !!collection,
    !!collection?.isActive,
    includesPermission(collection, user, [CollectionPermission.Manage])
  )
);

allow(User, "delete", Collection, (user, collection) =>
  and(
    !!collection,
    !collection?.deletedAt,
    includesPermission(collection, user, [CollectionPermission.Manage])
  )
);

allow(User, "restore", Collection, (user, collection) =>
  and(
    !!collection,
    !collection?.isActive,
    includesPermission(collection, user, [CollectionPermission.Manage])
  )
);

function includesPermission(
  collection: Collection | null,
  user: User,
  permissions: CollectionPermission[]
) {
  if (!collection) {
    return false;
  }
  const ownerId = collection.getDataValue("ownerId");
  if (ownerId && ownerId === user.id) {
    return [`owner:${collection.id}`];
  }

  const permissionSet = new Set(permissions);
  const grantIds: string[] = [];

  const grants = collection.permissionGrants ?? [];
  for (const grant of grants as Permission[]) {
    if (!matchesSubject(grant, user)) {
      continue;
    }

    const mapped =
      grant.permission === PermissionLevel.Manage
        ? CollectionPermission.Manage
        : grant.permission === PermissionLevel.Edit
          ? CollectionPermission.Edit
          : CollectionPermission.Read;

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

  // Group grants are pre-filtered by Collection.withPermissionGrants(userId)
  return grant.subjectType === PermissionSubjectType.Group;
}
