import { buildUser, buildWebhookSubscription } from "@server/test/factories";
import type { UserEvent } from "@server/types";
import WebhookProcessor from "./WebhookProcessor";

const mockDeliverWebhookSchedule = jest.fn();

jest.mock("../tasks/DeliverWebhookTask", () => ({
  __esModule: true,
  default: class MockDeliverWebhookTask {
    schedule = mockDeliverWebhookSchedule;
  },
}));
const ip = "127.0.0.1";

beforeEach(() => {
  jest.resetAllMocks();
});

describe("WebhookProcessor", () => {
  it("it schedules a delivery for the event", async () => {
    const subscription = await buildWebhookSubscription({
      url: "http://example.com",
      events: ["*"],
    });
    const signedInUser = await buildUser({ teamId: subscription.teamId });
    const processor = new WebhookProcessor();

    const event: UserEvent = {
      name: "users.signin",
      userId: signedInUser.id,
      teamId: subscription.teamId,
      actorId: signedInUser.id,
      ip,
    };

    await processor.perform(event);

    expect(mockDeliverWebhookSchedule).toHaveBeenCalled();
    expect(mockDeliverWebhookSchedule).toHaveBeenCalledWith({
      event,
      subscriptionId: subscription.id,
    });
  });

  it("not schedule a delivery when not subscribed to event", async () => {
    const subscription = await buildWebhookSubscription({
      url: "http://example.com",
      events: ["users.create"],
    });
    const signedInUser = await buildUser({ teamId: subscription.teamId });
    const processor = new WebhookProcessor();
    const event: UserEvent = {
      name: "users.signin",
      userId: signedInUser.id,
      teamId: subscription.teamId,
      actorId: signedInUser.id,
      ip,
    };

    await processor.perform(event);

    expect(mockDeliverWebhookSchedule).toHaveBeenCalledTimes(0);
  });

  it("it schedules a delivery for the event for each subscription", async () => {
    const subscription = await buildWebhookSubscription({
      url: "http://example.com",
      events: ["*"],
    });
    const subscriptionTwo = await buildWebhookSubscription({
      url: "http://example.com",
      teamId: subscription.teamId,
      events: ["*"],
    });
    const signedInUser = await buildUser({ teamId: subscription.teamId });
    const processor = new WebhookProcessor();

    const event: UserEvent = {
      name: "users.signin",
      userId: signedInUser.id,
      teamId: subscription.teamId,
      actorId: signedInUser.id,
      ip,
    };

    await processor.perform(event);

    expect(mockDeliverWebhookSchedule).toHaveBeenCalled();
    expect(mockDeliverWebhookSchedule).toHaveBeenCalledTimes(2);
    expect(mockDeliverWebhookSchedule).toHaveBeenCalledWith({
      event,
      subscriptionId: subscription.id,
    });
    expect(mockDeliverWebhookSchedule).toHaveBeenCalledWith({
      event,
      subscriptionId: subscriptionTwo.id,
    });
  });
});
