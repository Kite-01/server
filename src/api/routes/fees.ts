import { Digits, EvmAddress, UuidIdParams, PageQuery, Uuid } from "../schema";
import { ApiKeyScope, FeeType } from "../../shared/constants";
import { FeeService } from "../../services/Fee.service";
import { HttpError } from "../../shared/errors";
import { Elysia } from "elysia";
import { Auth } from "../middlewares/auth";
import { t } from "../schema";

const feeService = new FeeService();

const Scalar = t.Union([t.String(), t.Number(), t.Boolean()]);
const EqIn = (
  schema: ReturnType<typeof t.String> | ReturnType<typeof t.Union>,
) => {
  return t.Object(
    { _eq: t.Optional(schema), _in: t.Optional(t.Array(schema)) },
    { additionalProperties: false },
  );
};

const Currency = t.Object(
  { contractAddress: t.Optional(EqIn(EvmAddress)) },
  { additionalProperties: false },
);

const Condition = t.Object(
  {
    customer: t.Optional(t.Record(t.String(), EqIn(Scalar))),
    sourceCurrency: t.Optional(Currency),
    targetCurrency: t.Optional(Currency),
    sourceAmount: t.Optional(
      t.Object(
        {
          _eq: t.Optional(Digits),
          _gt: t.Optional(Digits),
          _gte: t.Optional(Digits),
          _lt: t.Optional(Digits),
          _lte: t.Optional(Digits),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

const FeeFields = {
  label: t.String({
    minLength: 1,
    maxLength: 120,
  }),
  type: t.Enum(FeeType),
  value: Digits,
  minAmountToCharge: t.Optional(t.Union([Digits, t.Null()])),
  maxAmountToCharge: t.Optional(t.Union([Digits, t.Null()])),
  condition: Condition,
  feeAddress: t.Optional(t.Union([EvmAddress, t.Null()])),
};

type FeeInput = {
  type?: FeeType;
  value?: string;
  minAmountToCharge?: string | null;
  maxAmountToCharge?: string | null;
};

const toBigInts = (input: FeeInput) => {
  const value = input.value === undefined ? undefined : BigInt(input.value);

  if (input.type === FeeType.Variable && !!value && value > 10000n) {
    throw new HttpError(
      400,
      "BadRequest",
      "A variable fee cannot exceed 10000 basis points",
    );
  }

  const n = (v: Maybe<string>) => (typeof v === "string" ? BigInt(v) : v);

  return {
    value,
    minAmountToCharge: n(input.minAmountToCharge),
    maxAmountToCharge: n(input.maxAmountToCharge),
  };
};

export const feeRoutes = new Elysia({ name: "FeesRoute" })
  .use(Auth.plugin)
  .get(
    "/fees",
    ({ actor, query }) => {
      return feeService.getFees({
        ...query,
        appId: actor.appId ?? null,
      });
    },
    {
      query: t.Object({
        chainId: t.Optional(Uuid),
        q: t.Optional(t.String({ maxLength: 100 })),
        ...PageQuery,
      }),
      beforeHandle: Auth.access({ scope: ApiKeyScope.FeeRead }),
      detail: {
        tags: ["Fees"],
        summary: "List fees",
      },
    },
  )
  .post(
    "/fees",
    async ({ actor, body, set }) => {
      const amounts = toBigInts(body);
      const created = await feeService.createFee({
        ...body,
        ...amounts,
        value: amounts.value!,
        appId: actor.appId ?? null,
      });

      set.status = 201;
      return created;
    },
    {
      body: t.Object({
        chainId: Uuid,
        ...FeeFields,
      }),
      beforeHandle: Auth.access({ scope: ApiKeyScope.FeeWrite }),
      detail: {
        tags: ["Fees"],
        summary: "Create a fee",
      },
    },
  )
  .get(
    "/fees/:id",
    async ({ actor, params }) => {
      const fee = await feeService.getFee(actor.appId ?? null, params.id);
      if (!fee) throw new HttpError(404, "NotFound", "Fee not found");
      return fee;
    },
    {
      params: UuidIdParams,
      beforeHandle: Auth.access({ scope: ApiKeyScope.FeeRead }),
      detail: {
        tags: ["Fees"],
        summary: "Get a fee",
      },
    },
  )
  .patch(
    "/fees/:id",
    async ({ actor, params, body }) => {
      const fee = await feeService.updateFee(actor.appId ?? null, params.id, {
        ...body,
        ...toBigInts(body),
      });

      if (!fee) throw new HttpError(404, "NotFound", "Fee not found");
      return fee;
    },
    {
      params: UuidIdParams,
      body: t.Partial(t.Object(FeeFields)),
      beforeHandle: Auth.access({ scope: ApiKeyScope.FeeWrite }),
      detail: {
        tags: ["Fees"],
        summary: "Update a fee",
      },
    },
  )
  .delete(
    "/fees/:id",
    async ({ actor, params }) => {
      const fee = await feeService.deleteFee(actor.appId ?? null, params.id);
      if (!fee) throw new HttpError(404, "NotFound", "Fee not found");
      return fee;
    },
    {
      params: UuidIdParams,
      beforeHandle: Auth.access({ scope: ApiKeyScope.FeeDelete }),
      detail: {
        tags: ["Fees"],
        summary: "Delete a fee",
      },
    },
  );
