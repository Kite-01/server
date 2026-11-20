# AGENTS.md

Notes for AI agents working in this repository, or reviewing it. Start with the [README](README.md): its NEAR HACKATHON section says what was built for the hackathon and how to try it.

## Commands

```sh
bun install && bun install --cwd client

# vitest, against a throwaway Postgres it starts itself
bun run test

# typecheck the server
bun run check

# typecheck the dashboard
cd client && bunx tsc --noEmit

# oxlint and Prettier
bun run lint
```

- `bun run test` needs no `.env`, keys or network: 1Click, the RPCs and the providers are stubbed.
- With Bun, `bun run test` exits with status 0 even when a test fails, so read the `Tests … passed` line.
- Run one file with `bunx --bun vitest run <path>`, and one test by adding `-t "<test name>"`.

## Layout

- `src/api/`: Elysia routes (`routes/`) and the TypeBox response models (`models.ts`).
- `src/services/`: business logic. Payouts through NEAR Intents are in `Payout.service.ts`.
- `src/sdks/`: chain and provider integrations:
  - `EvmActor`, `NearActor` and `StellarActor`: the operator wallet on EVM, on NEAR and on Stellar;
  - `NearIntents`: the 1Click API;
  - `QuickNode` and `Alchemy`: deposit notifiers;
  - `Alchemy` and `Thirdweb`: gas sponsors;
  - `Uniswap`, `Rhea` and `Soroswap`: swap quotes on EVM, on NEAR and on Stellar.
- `src/shared/chains/registry.ts`: every supported chain, with each provider's name for it under `descriptors`.
- `src/shared/kiteContract.ts`, `src/shared/kiteNearContract.ts` and `src/shared/kiteStellarContract.ts`: the Kite contracts on EVM, on NEAR and on Stellar. `predictAddress` on NEAR and on Stellar must stay byte for byte with the `types` crates of [Kite-01/near-contracts](https://github.com/Kite-01/near-contracts) and [Kite-01/stellar-contracts](https://github.com/Kite-01/stellar-contracts); their tests pin the same vectors. `kiteStellarContract.ts` lists what it assumes of the contracts at the top.
- `src/db/schema/`: drizzle tables. The migrations generated from them are in `drizzle/`.
- `src/shared/scheduler/`: pg-boss queues and workers.
- `src/test/`: test setup, factories and API helpers. `setup.mts` stubs NEAR Intents, the scheduler and the operator wallets.
- `client/`: the React dashboard and checkout. `client/src/api/` is generated from the OpenAPI spec by Hey API, so don't edit it by hand.

## Rules

- **Secrets**: never commit `.env` or any key. `src/shared/env.ts` loads `.env` from the current directory, so run scripts and servers with throwaway values, never the repository's `.env`.
- **Strict response models**: a route that returns a property its model doesn't declare answers 500. Leave internal columns out of queries, as with `trackedBy`, or add them to the model.
- **Schema changes**: edit `src/db/schema/`, then run `bun run db:generate`. Never edit a migration that's already been applied.
- **Style**: format with Prettier (`bun run format`), and keep comments as sparse as in the code around them.
