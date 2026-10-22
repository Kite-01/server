import { EvmAddress, Uuid, UuidIdParams } from "../schema";
import { PriceFeedService } from "../../services/PriceFeed.service";
import { models } from "../models";
import { Elysia } from "elysia";
import { Auth } from "../middlewares/auth";
import { t } from "../schema";

const priceFeedService = new PriceFeedService();

export const priceFeedRoutes = new Elysia({ name: "PriceFeedsRoute" })
  .use(Auth.plugin)
  .use(models)
  .onBeforeHandle(Auth.access({ root: true }))
  .get("/price-feeds", () => priceFeedService.getPriceFeeds(), {
    response: {
      200: "PriceFeedWithChainList",
    },
    detail: {
      operationId: "priceFeeds.list",
      security: [{ rootKey: [] }],
      tags: ["Price feeds"],
      summary: "List price feeds",
    },
  })
  .post(
    "/price-feeds",
    async ({ body, set }) => {
      const feed = await priceFeedService.createPriceFeed(body);

      set.status = 201;
      return feed;
    },
    {
      parse: "json",
      body: t.Object({
        chainId: Uuid,
        address: EvmAddress,
      }),
      response: {
        201: "PriceFeed",
      },
      detail: {
        operationId: "priceFeeds.create",
        security: [{ rootKey: [] }],
        tags: ["Price feeds"],
        summary: "Add a Chainlink price feed",
      },
    },
  )
  .delete(
    "/price-feeds/:id",
    async ({ params }) => {
      await priceFeedService.deletePriceFeed(params.id);
      return {
        id: params.id,
      };
    },
    {
      params: UuidIdParams,
      response: {
        200: t.Object({
          id: Uuid,
        }),
      },
      detail: {
        operationId: "priceFeeds.delete",
        security: [{ rootKey: [] }],
        tags: ["Price feeds"],
        summary: "Delete a price feed",
      },
    },
  );
