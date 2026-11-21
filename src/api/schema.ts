import { t as typebox } from "elysia";

export const t: typeof typebox = {
  ...typebox,
  Object: ((properties, options) =>
    typebox.Object(properties, {
      additionalProperties: false,
      ...options,
    })) as typeof typebox.Object,
};

export const Uuid = t.String({
  format: "uuid",
});

export const UuidIdParams = t.Object({
  id: Uuid,
});

export const PageQuery = {
  page: t.Optional(
    t.Numeric({
      minimum: 1,
    }),
  ),
  pageSize: t.Optional(
    t.Numeric({
      minimum: 1,
      maximum: 100,
    }),
  ),
};

export const Digits = t.String({
  pattern: "^[0-9]+$",
  maxLength: 78,
});

export const EvmAddress = t.String({
  pattern: "^0x[0-9a-fA-F]{40}$",
});

export const ChainAddress = t.String({
  minLength: 2,
  maxLength: 69,
  pattern:
    // a NEAR id starting with 0x is ETH-implicit, so it's an EVM address too
    "^(0x[0-9a-fA-F]{40}|(?!0x)(([a-z\\d]+[-_])*[a-z\\d]+\\.)*([a-z\\d]+[-_])*[a-z\\d]+|[GC][A-Z2-7]{55}|M[A-Z2-7]{68})$",
});

export const Origin = t.String({
  pattern: "^https?://[^/\\s]+$",
  maxLength: 255,
});
