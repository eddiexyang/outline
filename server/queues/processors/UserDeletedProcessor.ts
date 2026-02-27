import {
  ApiKey,
  GroupUser,
  OAuthAuthentication,
  Permission,
  Star,
  Subscription,
  UserAuthentication,
} from "@server/models";
import { PermissionSubjectType } from "@server/models/Permission";
import { sequelize } from "@server/storage/database";
import type { Event as TEvent, UserEvent } from "@server/types";
import BaseProcessor from "./BaseProcessor";

export default class UserDeletedProcessor extends BaseProcessor {
  static applicableEvents: TEvent["name"][] = ["users.delete"];

  async perform(event: UserEvent) {
    await sequelize.transaction(async (transaction) => {
      await GroupUser.destroy({
        where: {
          userId: event.userId,
        },
        transaction,
        individualHooks: true,
      });
      await UserAuthentication.destroy({
        where: {
          userId: event.userId,
        },
        transaction,
      });
      await Permission.destroy({
        where: {
          subjectType: PermissionSubjectType.User,
          subjectId: event.userId,
        },
        transaction,
      });
      await Subscription.destroy({
        where: {
          userId: event.userId,
        },
        transaction,
      });
      await ApiKey.destroy({
        where: {
          userId: event.userId,
        },
        transaction,
      });
      await OAuthAuthentication.destroy({
        where: {
          userId: event.userId,
        },
        transaction,
      });
      await Star.destroy({
        where: {
          userId: event.userId,
        },
        transaction,
      });
    });
  }
}
