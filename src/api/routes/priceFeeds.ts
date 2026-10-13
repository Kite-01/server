import { EvmAddress, Uuid, UuidIdParams } from "../schema";
import { PriceFeedService } from "../../services/PriceFeed.service";
import { Elysia } from "elysia";
import { Auth } from "../middlewares/auth";
import { t } from "../schema";

const priceFeedService = new PriceFeedService();

export const priceFeedRoutes = new Elysia({ name: "PriceFeedsRoute" })
  .use(Auth.plugin)
  .onBeforeHandle(Auth.access({ root: true }))
  .get("/price-feeds", () => priceFeedService.getPriceFeeds(), {
    detail: {
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
      body: t.Object({
        chainId: Uuid,
        address: EvmAddress,
      }),
      detail: {
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
      detail: {
        tags: ["Price feeds"],
        summary: "Delete a price feed",
      },
    },
  );
