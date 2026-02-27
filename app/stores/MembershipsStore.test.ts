import { CollectionPermission } from "@shared/types";
import stores from "~/stores";
import { client } from "~/utils/ApiClient";

describe("MembershipsStore", () => {
  const collectionId = "collection-1";
  const userId = "user-1";

  beforeEach(() => {
    stores.memberships.clear();
    stores.users.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("replaces local membership for the same user when permission update returns a new id", async () => {
    const existingMembership = stores.memberships.add({
      id: "membership-old",
      permission: CollectionPermission.Read,
    });
    existingMembership.collectionId = collectionId;
    existingMembership.userId = userId;

    jest.spyOn(client, "post").mockResolvedValue({
      data: {
        users: [{ id: userId, name: "User One" }],
        memberships: [
          {
            id: "membership-new",
            permission: CollectionPermission.Edit,
          },
        ],
      },
    });

    await stores.memberships.create({
      collectionId,
      userId,
      permission: CollectionPermission.Edit,
    });

    expect(stores.memberships.data.has("membership-old")).toBe(false);
    expect(stores.memberships.data.has("membership-new")).toBe(true);
    expect(stores.memberships.data.size).toBe(1);
    expect(stores.memberships.get("membership-new")?.permission).toBe(
      CollectionPermission.Edit
    );
  });
});
