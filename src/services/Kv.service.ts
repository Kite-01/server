import {
  getProviderStatuses,
  KeyVarDependents,
  SettableKeyVars,
} from "../shared/providers/registry";
import { KeyType, KeyVars } from "../shared/constants";
import { AppError } from "../shared/errors";
import { eq, inArray } from "drizzle-orm";
import { crypt } from "../shared/crypt";
import { kv } from "../db/schema";
import { db } from "../db";

export class KvService {
  private encode = (key: KeyVars, type: KeyType, value?: string | null) =>
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

  createKv = async (input: typeof kv.$inferInsert) => {
    const value = this.encode(input.key, input.type, input.value);
    await db.insert(kv).values({
      ...input,
      value,
    });
  };

  updateKv = async (key: KeyVars, type: KeyType, value: string | null) => {
    await db
      .update(kv)
      .set({ value: this.encode(key, type, value) })
      .where(eq(kv.key, key));
  };

  deleteKv = async (key: KeyVars) => db.delete(kv).where(eq(kv.key, key));

  getKv = async (key: KeyVars) => {
    const row = await db.query.kv.findFirst({ where: eq(kv.key, key) });
    return row ? this.decode(row) : null;
  };

  getKvs = async (keys?: KeyVars[]) => {
    if (keys && keys.length === 0) {
      return [];
    }

    const rows = keys
      ? await db.query.kv.findMany({ where: inArray(kv.key, keys) })
      : await db.query.kv.findMany();

    return rows.map(this.decode);
  };

  /**
   * Sets a key an operator owns, such as a provider's API key. Changing a key
   * drops the state created under the old value (e.g. the provider's webhook
   * ids), so it is created again under the new one.
   */
  setProviderKey = async (key: KeyVars, input: string | null) => {
    const value = input?.trim() || null;
    const type = SettableKeyVars[key];
    if (!type) throw new AppError(`${key} is managed by the server`);

    const previous = await this.getKv(key);
    await this.upsertKv({ key, type, value });

    const dependents = KeyVarDependents[key] ?? [];
    if (dependents.length && (previous?.value ?? null) !== value) {
      await db.delete(kv).where(inArray(kv.key, dependents));
    }

    return (await this.getKv(key))!;
  };

  getProviderStatuses = async () =>
    getProviderStatuses(await this.getSdkOptionVariables());

  getSdkOptionVariables = async () => {
    const kvs = await this.getKvs();
    return Object.fromEntries(
      kvs.flatMap((kv) => [[kv.key, kv.value ?? null]]),
    );
  };
}
