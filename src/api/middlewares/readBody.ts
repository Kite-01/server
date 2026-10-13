import { HttpError } from "../../shared/errors";

export const readBody = async (request: Request, limit: number) => {
  const contentLength = request.headers.get("content-length");
  const declared = Number(contentLength ?? 0);
  if (declared > limit) {
    throw new HttpError(413, "PayloadTooLarge", "Request body is too large");
  }

  const reader = request.body?.getReader();
  if (!reader) {
    return Buffer.alloc(0);
  }

  const chunks: Uint8Array[] = [];
  let size = 0;

  for (;;) {
    const result = await reader.read();
    if (result.done) {
      break;
    }

    size += result.value.length;

    if (size > limit) {
      await reader.cancel();
      throw new HttpError(413, "PayloadTooLarge", "Request body is too large");
    }

    chunks.push(result.value);
  }

  return Buffer.concat(chunks);
};
