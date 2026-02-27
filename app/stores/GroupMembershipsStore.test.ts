import { CollectionPermission, DocumentPermission } from "@shared/types";
import stores from "~/stores";
import { client } from "~/utils/ApiClient";

describe("GroupMembershipsStore", () => {
  const collectionId = "collection-1";
  const documentId = "document-1";
  const groupId = "group-1";

  beforeEach(() => {
    stores.groupMemberships.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("replaces local collection group membership when permission update returns a new id", async () => {
    const existingMembership = stores.groupMemberships.add({
      id: "group-membership-old",
      permission: CollectionPermission.Read,
    });
    existingMembership.collectionId = collectionId;
    existingMembership.groupId = groupId;

    jest.spyOn(client, "post").mockResolvedValue({
      data: {
        groupMemberships: [
          {
            id: "group-membership-new",
            permission: CollectionPermission.Manage,
          },
        ],
      },
    });

    await stores.groupMemberships.create({
      collectionId,
      groupId,
      permission: CollectionPermission.Manage,
    });

    expect(stores.groupMemberships.data.has("group-membership-old")).toBe(
      false
    );
    expect(stores.groupMemberships.data.has("group-membership-new")).toBe(true);
    expect(stores.groupMemberships.data.size).toBe(1);
    expect(stores.groupMemberships.get("group-membership-new")?.permission).toBe(
      CollectionPermission.Manage
    );
  });

  test("replaces local document group membership when permission update returns a new id", async () => {
    const existingMembership = stores.groupMemberships.add({
      id: "group-membership-doc-old",
      permission: DocumentPermission.Read,
    });
    existingMembership.documentId = documentId;
    existingMembership.groupId = groupId;

    jest.spyOn(client, "post").mockResolvedValue({
      data: {
        groupMemberships: [
          {
            id: "group-membership-doc-new",
            permission: DocumentPermission.Edit,
          },
        ],
      },
    });

    await stores.groupMemberships.create({
      documentId,
      groupId,
      permission: DocumentPermission.Edit,
    });

    expect(stores.groupMemberships.data.has("group-membership-doc-old")).toBe(
      false
    );
    expect(stores.groupMemberships.data.has("group-membership-doc-new")).toBe(
      true
    );
    expect(stores.groupMemberships.data.size).toBe(1);
    expect(
      stores.groupMemberships.get("group-membership-doc-new")?.permission
    ).toBe(DocumentPermission.Edit);
  });
});
