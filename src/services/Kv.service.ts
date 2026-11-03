import {
  getProviderStatuses,
  KeyVarDependents,
  KeyVarTypes,
} from "../shared/providers/registry";
import {
  KeyType,
  KeyVarPrefix,
  KeyVars,
  type KvKey,
} from "../shared/constants";
import { eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import { AppError, NotFoundError } from "../shared/errors";
import { crypt } from "../shared/crypt";
import { kv } from "../db/schema";
import { db } from "../db";

export class KvService {
  private encode = (key: KvKey, type: KeyType, value?: string | null) =>
    !!value && type === KeyType.SecureString
      ? crypt.encrypt(value, key)
      : (value ?? null);

  private decode = (row: typeof kv.$inferSelect) => ({
    ...row,
    value:
      !!row.value && row.type === KeyType.SecureString
        ? crypt.decrypt(row.value, row.key)
        : row.value,
  });

  upsertKv = async (input: typeof kv.$inferInsert) => {
    const value = this.encode(input.key, input.type, input.value);

    await db
      .insert(kv)
      .values({ ...input, value })
      .onConflictDoUpdate({
        target: kv.key,
        set: {
          value,
          type: input.type,
          updatedAt: new Date(),
        },
      });
  };

  getOrCreateKv = async (input: {
    key: KvKey;
    type: KeyType;
    value: string;
  }) => {
    const value = this.encode(input.key, input.type, input.value);

    await db
      .insert(kv)
      .values({ ...input, value })
      .onConflictDoUpdate({
        target: kv.key,
        set: {
          value,
          type: input.type,
          updatedAt: new Date(),
        },
        setWhere: isNull(kv.value),
      });

    return (await this.getKv(input.key))!.value!;
  };

  createKv = async (input: typeof kv.$inferInsert) => {
    const value = this.encode(input.key, input.type, input.value);
    await db.insert(kv).values({
      ...input,
      value,
    });
  };

  updateKv = async (key: KvKey, type: KeyType, value: string | null) => {
    await db
      .update(kv)
      .set({ value: this.encode(key, type, value) })
      .where(eq(kv.key, key));
  };

  deleteKv = async (key: KvKey) => db.delete(kv).where(eq(kv.key, key));

  getKv = async (key: KvKey) => {
    const row = await db.query.kv.findFirst({ where: eq(kv.key, key) });
    return row ? this.decode(row) : null;
  };

  getKvs = async (keys?: KvKey[]) => {
    if (keys && keys.length === 0) {
      return [];
    }

    const rows = keys
      ? await db.query.kv.findMany({ where: inArray(kv.key, keys) })
      : await db.query.kv.findMany();

    return rows.map(this.decode);
  };

  setKey = async (key: KvKey, input: string | null) => {
    const value = input?.trim() || null;
    const type = KeyVarTypes[key.split(":")[0] as KeyVars | KeyVarPrefix];
    if (!type) {
      throw new AppError(`${key} is not a key the server reads`);
    }

    const previous = await this.getKv(key);

    await this.upsertKv({
      key,
      type,
      value,
    });

    if ((previous?.value ?? null) !== value) {
      await this.deleteDependents(key);
    }

    return (await this.getKv(key))!;
  };

  deleteKey = async (key: string) => {
    const [row] = await db
      .delete(kv)
      .where(eq(kv.key, key as KvKey))
      .returning({ key: kv.key });

    if (!row) {
      throw new NotFoundError("kv", key);
    }

    await this.deleteDependents(row.key);
  };

  private deleteDependents = async (key: KvKey) => {
    const dependents = KeyVarDependents[key as KeyVars] ?? [];
    if (!dependents.length) return;

    await db
      .delete(kv)
      .where(or(...dependents.map((prefix) => like(kv.key, `${prefix}:%`))));
  };

  // Serialises work on a key across processes, for values that can't be
  // created twice, such as a provider webhook.
  withLock = <T>(key: KvKey, task: () => Promise<T>) => {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
      return task();
    });
  };

  getProviderStatuses = async () => {
    const variables = await this.getSdkOptionVariables();
    return getProviderStatuses(variables);
  };

  getSdkOptionVariables = async () => {
    const kvs = await this.getKvs();
    return Object.fromEntries(
      kvs.flatMap((kv) => [[kv.key, kv.value ?? null]]),
    );
  };
}
