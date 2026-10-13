import { beforeEach, describe, expect, it } from "vitest";
import { WebhookCategory } from "../../shared/constants";
import { resetMocks, schedulerMock } from "../../test/mocks";
import { createApp } from "../../test/factories";
import { EventService } from "../Event.service";
import { event } from "../../db/schema";
import { db } from "../../db";

const service = new EventService();

describe("EventService", () => {
  let appId: string;

  beforeEach(async () => {
    resetMocks();
    appId = (await createApp()).id;
  });

  it("stores an event and queues its fan-out", async () => {
    const created = await service.createEvent({
      appId,
      category: WebhookCategory.Transfer,
      currentCategoryStatus: "Settled",
      data: { id: "t-1" },
    });

    expect(schedulerMock.enqueueEvent).toHaveBeenCalledWith(
      appId,
      created.id,
      expect.anything(),
    );
    expect((await service.getEvent(appId, created.id))?.data).toEqual({
      id: "t-1",
    });
  });

  it("does not keep the event when it cannot be queued", async () => {
    schedulerMock.enqueueEvent.mockRejectedValueOnce(new Error("queue down"));

    await expect(
      service.createEvent({
        appId,
        category: WebhookCategory.Deposit,
        currentCategoryStatus: "Completed",
        data: {},
      }),
    ).rejects.toThrow("queue down");

    expect(await db.select().from(event)).toHaveLength(0);
  });

  it("only returns an event to its own app", async () => {
    const created = await service.createEvent({
      appId,
      category: WebhookCategory.Transfer,
      currentCategoryStatus: "Settled",
      data: {},
    });
    const other = await createApp();

    expect(await service.getEvent(other.id, created.id)).toBeUndefined();
  });

  it("lists newest first, filtered by app and category", async () => {
    const other = await createApp();
    const make = (app: string, category: WebhookCategory) =>
      service.createEvent({
        appId: app,
        category,
        currentCategoryStatus: "x",
        data: {},
      });

    const a = await make(appId, WebhookCategory.Transfer);
    const b = await make(appId, WebhookCategory.Deposit);
    const c = await make(other.id, WebhookCategory.Transfer);

    expect((await service.getEvents({ appId })).data.map((e) => e.id)).toEqual([
      b.id,
      a.id,
    ]);
    expect(
      (
        await service.getEvents({
          appId,
          category: WebhookCategory.Deposit,
        })
      ).data.map((e) => e.id),
    ).toEqual([b.id]);
    expect((await service.getEvents({})).data.map((e) => e.id)).toEqual([
      c.id,
      b.id,
      a.id,
    ]);
  });
});
