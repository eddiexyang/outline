import { Share, Team, User } from "@server/models";
import { allow, can } from "./cancan";
import { and, isOwner, isTeamModel, isTeamMutable, or } from "./utils";

allow(User, "createShare", Team, (actor, team) =>
  and(
    //
    isTeamModel(actor, team),
    isTeamMutable(actor),
    !actor.isViewer
  )
);

allow(User, "listShares", Team, (actor, team) =>
  and(
    //
    isTeamModel(actor, team),
    !actor.isViewer
  )
);

allow(User, "read", Share, (actor, share) =>
  and(
    //
    isTeamModel(actor, share),
    !actor.isViewer
  )
);

allow(User, "update", Share, (actor, share) =>
  and(
    isTeamModel(actor, share),
    !actor.isViewer,
    or(
      can(actor, "share", share?.collection),
      can(actor, "share", share?.document)
    )
  )
);

allow(User, "revoke", Share, (actor, share) =>
  and(
    isTeamModel(actor, share),
    !actor.isViewer,
    or(actor.isAdmin, isOwner(actor, share))
  )
);
