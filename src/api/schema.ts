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

export const Origin = t.String({
  pattern: "^https?://[^/\\s]+$",
  maxLength: 255,
});
