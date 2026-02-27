import * as React from "react";
import { Collection, Permission } from "@server/models";
import {
  PermissionLevel,
  PermissionResourceType,
  PermissionSubjectType,
} from "@server/models/Permission";
import type { EmailProps } from "./BaseEmail";
import BaseEmail, { EmailMessageCategory } from "./BaseEmail";
import Body from "./components/Body";
import Button from "./components/Button";
import EmailTemplate from "./components/EmailLayout";
import Header from "./components/Header";
import Heading from "./components/Heading";

type InputProps = EmailProps & {
  userId: string;
  collectionId: string;
  actorName: string;
  teamUrl: string;
};

type BeforeSend = {
  collection: Collection;
  permissionGrant: Permission;
};

type Props = InputProps & BeforeSend;

/**
 * Email sent to a user when someone adds them to a collection.
 */
export default class CollectionSharedEmail extends BaseEmail<
  InputProps,
  BeforeSend
> {
  protected get category() {
    return EmailMessageCategory.Notification;
  }

  protected async beforeSend({ userId, collectionId }: InputProps) {
    const collection = await Collection.findByPk(collectionId);
    if (!collection) {
      return false;
    }

    const permissionGrant = await Permission.findOne({
      where: {
        subjectType: PermissionSubjectType.User,
        subjectId: userId,
        resourceType: PermissionResourceType.Collection,
        resourceId: collectionId,
        deletedAt: null,
      },
    });
    if (!permissionGrant) {
      return false;
    }

    return { collection, permissionGrant };
  }

  protected subject({ actorName, collection }: Props) {
    return `${actorName} invited you to the “${collection.name}” collection`;
  }

  protected preview({ actorName }: Props): string {
    return `${actorName} invited you to a collection`;
  }

  protected fromName({ actorName }: Props) {
    return actorName;
  }

  protected renderAsText({ actorName, teamUrl, collection }: Props): string {
    return `
${actorName} invited you to the “${collection.name}” collection.

View Document: ${teamUrl}${collection.path}
`;
  }

  protected render(props: Props) {
    const { collection, permissionGrant, actorName, teamUrl } = props;
    const collectionUrl = `${teamUrl}${collection.path}?ref=notification-email`;

    const permission =
      permissionGrant.permission === PermissionLevel.Edit
        ? "view and edit"
        : permissionGrant.permission === PermissionLevel.Manage
          ? "manage"
          : "view";

    return (
      <EmailTemplate
        previewText={this.preview(props)}
        goToAction={{ url: collectionUrl, name: "View Collection" }}
      >
        <Header />

        <Body>
          <Heading>{collection.name}</Heading>
          <p>
            {actorName} invited you to {permission} documents in the{" "}
            <a href={collectionUrl}>{collection.name}</a> collection.
          </p>
          <p>
            <Button href={collectionUrl}>View Collection</Button>
          </p>
        </Body>
      </EmailTemplate>
    );
  }
}
