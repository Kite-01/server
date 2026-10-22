import {
  ProviderNotConfiguredForActionError,
  ChainNotSupportedByProviderError,
  ProviderYetToBeConfiguredError,
  ChainNotConfiguredForx402Error,
  ChainNotSupportedError,
  QuoteExpiredError,
  PreconditionError,
  UnsafeUrlError,
  NotFoundError,
  HttpError,
  AppError,
} from "../../shared/errors";
import { z, ZodError } from "zod";

export const handleError = (error: unknown) => {
  if (error instanceof HttpError) {
    return error;
  }

  if (error instanceof NotFoundError) {
    return new HttpError(404, "NotFound", `${error.resource} not found`);
  }

  if (error instanceof QuoteExpiredError) {
    return new HttpError(409, "QuoteExpired", error.message);
  }

  if (error instanceof PreconditionError) {
    return new HttpError(409, "PreconditionFailed", error.message);
  }

  if (error instanceof AppError || error instanceof UnsafeUrlError) {
    return new HttpError(400, "BadRequest", error.message);
  }

  if (
    error instanceof ChainNotSupportedError ||
    error instanceof ChainNotSupportedByProviderError ||
    error instanceof ChainNotConfiguredForx402Error ||
    error instanceof ProviderNotConfiguredForActionError ||
    error instanceof ProviderYetToBeConfiguredError
  ) {
    return new HttpError(422, "NotSupported", error.message);
  }

  if (error instanceof ZodError) {
    return new HttpError(
      422,
      "ValidationError",
      z.treeifyError(error).errors.join(", "),
    );
  }

  const postgresCode = (error: unknown): string | undefined => {
    const candidate = error as null | {
      code?: unknown;
      cause?: unknown;
    };

    if (typeof candidate?.code === "string") {
      return candidate.code;
    }

    return candidate?.cause ? postgresCode(candidate.cause) : undefined;
  };

  switch (postgresCode(error)) {
    case "23505":
      return new HttpError(409, "Conflict", "Resource already exists");
    case "23001":
    case "23503":
      return new HttpError(
        409,
        "Conflict",
        "Resource is referenced by, or references, something that does not exist",
      );
    case "23514":
      return new HttpError(422, "ValidationError", "Value is not allowed");
    case "22P02":
      return new HttpError(400, "BadRequest", "Malformed identifier");
  }

  return null;
};
