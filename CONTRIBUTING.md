# Contributing

Thanks for helping with Kite. This repo is the server: the API, the dashboard and the public checkout.

Found a security issue? Don't open an issue or pull request; follow [SECURITY.md](SECURITY.md).

## Before you start

For anything beyond a small fix, open an issue first and describe the change, so we can agree on the approach before you build it.

Related repos:

- [Kite-01/contracts](https://github.com/Kite-01/contracts): the smart contracts each payment runs through
- [Kite-01/monorepo](https://github.com/Kite-01/monorepo): `@kite-01/sdk` and `@kite-01/js`, generated from this server's API spec

## Setup

You need [Bun](https://bun.sh) 1.4 or newer. Tests start their own throwaway Postgres, so you don't need one to run them.

```sh
bun install
bun install --cwd client
bun run test
```

To run the server itself, follow [Getting started](README.md#getting-started) in the README.

## Making a change

1. Fork the repo and branch from `main`.
2. Make the change, with tests. They live in `__tests__` folders next to the code they cover; `src/test/` has the factories and helpers.
3. Run the checks; all must pass:

   ```sh
   bun run lint
   bun run check
   bun run test
   bun run build
   ```

   `bun run format` fixes formatting.

4. Open a pull request saying what changed and why. Link the issue if there is one.

### Database changes

Change the schema in `src/db/schema/`, then generate a migration and commit it with your change:

```sh
bun run db:generate --name describe_the_change
```

Never edit a migration that has already been merged; add a new one.

### API changes

Every route needs an `operationId` (named `group.action`, such as `paymentLinks.create`) in its `detail`; the SDK uses it as the method name, and a test fails without one. Root-only and keyless routes also state their `security`.

The dashboard's client in `client/src/api/` is generated from the spec. `bun run dev` regenerates it; commit the result with your change. After an API change is released, the SDK picks it up with `pnpm spec:pull` in the monorepo.

### Style

Match the code around you. Write comments only where the code can't explain itself, such as why a check exists or an ordering that matters.

## License

By contributing, you agree your contributions are licensed under the project's license, the [GNU AGPL v3.0 with the additional terms in NOTICE.md](NOTICE.md). You also grant the Kite authors a perpetual, irrevocable right to license your contributions under other terms, including commercial licenses.
