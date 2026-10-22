import { formatUnits, parseUnits } from "viem";
import { PriceFeedService } from "../../services/PriceFeed.service";
import { HttpError } from "../../shared/errors";
import { Elysia } from "elysia";
import { Auth } from "../middlewares/auth";
import { t } from "../schema";

const priceFeedService = new PriceFeedService();

export const rateRoutes = new Elysia({ name: "RatesRoute" })
  .use(Auth.plugin)
  .get(
    "/rate",
    async ({ query }) => {
      const currency = query.currency.toUpperCase();
      const isSupported = await priceFeedService.isSupportedCurrency(currency);
      if (!isSupported) {
        throw new HttpError(
          422,
          "ValidationError",
          `${currency} is not a supported currency`,
        );
      }

      let usdAmount = parseUnits(query.amount, 18);
      let usdDecimals = 18;

      const price = await priceFeedService.getPrice(currency, "USD");

      usdAmount *= price.answer;
      usdDecimals += price.decimals;

      return {
        from: {
          currency,
          amount: query.amount,
        },
        to: {
          currency: "USD",
          amount: formatUnits(usdAmount, usdDecimals),
        },
      };
    },
    {
      query: t.Object({
        currency: t.String({
          minLength: 2,
          maxLength: 10,
        }),
        amount: t.String({
          pattern: "^(?:0|[1-9][0-9]{0,19})(?:\\.[0-9]{1,18})?$",
        }),
      }),
      response: {
        200: t.Object({
          from: t.Object({
            currency: t.String(),
            amount: t.String(),
          }),
          to: t.Object({
            currency: t.String(),
            amount: t.String(),
          }),
        }),
      },
      detail: {
        operationId: "rates.get",
        tags: ["Rates"],
        summary: "Get live currency rate",
      },
    },
  );
