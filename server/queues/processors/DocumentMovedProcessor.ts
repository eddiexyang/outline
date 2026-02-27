import { Document } from "@server/models";
import { sequelize } from "@server/storage/database";
import type { DocumentMovedEvent, Event } from "@server/types";
import BaseProcessor from "./BaseProcessor";

export default class DocumentMovedProcessor extends BaseProcessor {
  static applicableEvents: Event["name"][] = ["documents.move"];

  async perform(event: DocumentMovedEvent) {
    await sequelize.transaction(async (transaction) => {
      const document = await Document.findByPk(event.documentId, {
        transaction,
      });
      if (!document) {
        return;
      }
      // Permission inheritance is resolved dynamically via PermissionResolver,
      // so document moves no longer require sourced membership recalculation.
    });
  }
}
