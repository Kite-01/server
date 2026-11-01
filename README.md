<div align="center">
  <img src="client/public/logo.png" alt="Kite logo" width="260" />
</div>

# Kite

Kite is an open-source crypto payment processor that a business runs itself. The business creates a payment link, the customer pays it from their wallet in any token on one of the business's chains, a Kite contract settles the payment on-chain, and a signed webhook tells the business's systems.

With [NEAR Intents](https://docs.near-intents.org/), the business can receive every payment as one token on one chain, for example USDC on NEAR at `shop.near`, whichever chain and token the customer paid with.

This repository is the server: the API, the dashboard the business runs it from, and the checkout page customers pay on. The [contracts](https://github.com/Kite-01/contracts) and the [SDK](https://github.com/Kite-01/monorepo) live in their own repositories.

### The problem

- **Agents can't pay a normal store.** An AI agent buying something for someone can't get through a checkout built for people, so an ordinary e-commerce store can't take its payment. Every Kite payment link is also an [x402](https://www.x402.org) resource, which an agent pays with an HTTP request, so a store that takes payments through Kite can be paid by agents as well as people.
- **Payments end up on every chain.** A business taking crypto on several chains ends up with balances spread across all of them, in whatever token each chain settles in. Gathering the money in one place means bridging and swapping by hand, and holding gas on every chain to do it.

### What NEAR Intents does in Kite

A business sets a **payout token** and **payout address** on its app, for example USDC on NEAR at `shop.near`. Then, for each payment:

1. **The transfer opens**: Kite asks NEAR Intents' 1Click API for a `FLEX_INPUT` quote that converts the paying chain's settlement token into the payout token and delivers it to the payout address. Refunds go to the app's own address on the paying chain.
2. **The customer pays**: the Kite contract settles the payment straight into the quote's deposit address. Kite never holds the business's money: the contract pays Intents directly, and Intents pays the business.
3. **The payout is tracked**: Kite polls 1Click until the payout is delivered (with the delivery transaction), refunded or failed. Each outcome is written to the transfer's timeline and shown in the dashboard.

Destinations are checked when they're set. Kite asks for a dry quote, which moves no money, and 1Click rejects an address it can't deliver to.

A payment settles to the app's address on the paying chain instead when Intents can't take it:

- Intents has no route for the chain or its settlement token.
- 1Click can't quote the payment.
- The deposit address is within 30 minutes of its deadline.

### Limitations

What Kite can do on a chain depends on the providers that support it. [`src/shared/chains/registry.ts`](src/shared/chains/registry.ts) lists every supported chain, with the providers that support it under `descriptors`.

- **Agents only pay through payment links**: a store that keeps its own checkout still can't take payments from agents.
- **On chains NEAR Intents doesn't support**, payments settle to the app's address on the paying chain, even when the app has a payout set.
- **On chains without an onchain notifier**, deposits are found by a balance check every minute, and deposit webhooks aren't sent.
- **On chains without a gas sponsor**, the operator wallet pays the gas.
- **x402 needs EIP-3009**: on chains whose settlement token doesn't support it, agents can't pay and customers pay their own gas.
- **NEAR Intents has no testnet**, so payouts only happen on mainnet.

## What Kite does

- **Payment links**: priced in a fiat currency, with optional line items, your own `reference` and `meta`. A link can be one-time or reusable.
- **Checkout**: customers pay by connecting a wallet or by sending tokens to an address, shown as a QR code or text.
- **Agent payments**: a payment link is also an [x402](https://www.x402.org) resource. An agent that requests `/pay/<id>` with GET or POST gets a `402` offering every network that takes x402, signs one and pays by repeating the request.
- **Any token in, your token out**: payments in another token are swapped through Uniswap V3, or V2 where a chain has no V3. They're priced from time-weighted averages, so a pool someone just moved can't skew a quote.
- **Settlement on-chain**: each payment runs through its own [Kite contract](https://github.com/Kite-01/contracts), which settles, pays fees or refunds.
- **Payouts through NEAR Intents**: every payment delivered as one token on one chain
- **Webhooks** for every transfer status change, signed so you can verify them.
- **Apps and API keys**: separate businesses or projects, each with the chains it accepts and an address on each, and scoped API keys.
- **OpenAPI** spec and interactive docs at `/openapi`.
- Fees, chains, tokens and price feeds, all managed from the dashboard.

## Getting started

You need [Bun](https://bun.sh) 1.4+ and PostgreSQL.

1. **Install**

   ```sh
   bun install
   bun install --cwd client
   ```

2. **Start Postgres**, if you don't have one. This matches `.env.example`:

   ```sh
   docker run -d --name kite-db -p 54320:5432 \
     -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=kite postgres:17
   ```

3. **Configure**: copy `.env.example` to `.env` and fill it in (see [Configuration](#configuration)). At minimum, set your own `KITE_ENCRYPTION_KEY`, `KITE_OPERATOR_MNEMONIC` and `KITE_ROOT_KEY`.

4. **Migrate and run**

   ```sh
   bun run migrate
   bun run dev
   ```

   The API and dashboard run together on `KITE_PORT` with hot reload.

5. **Deploy your own Kite factory** on each chain you'll take payments on, as described in [Deploying](https://github.com/Kite-01/contracts#deploying) in the contracts repository. Make your server's operator wallet its operator. Kite only settles through a factory where its operator wallet holds the operator role, so it refuses anyone else's, ours included.

   The operator wallet is the first account of `KITE_OPERATOR_MNEMONIC`. Run this from the repository root, where Bun loads your `.env`, to print its address:

   ```sh
   bun -e 'import { mnemonicToAccount } from "viem/accounts"; console.log(mnemonicToAccount(process.env.KITE_OPERATOR_MNEMONIC).address)'
   ```

6. **Set it up in the dashboard**: open `http://localhost:3000`, sign in with your root key, then:
   1. under **Providers**, add the keys for a deposit notifier (QuickNode or Alchemy) and, optionally, a gas sponsor (Alchemy or thirdweb). Without a sponsor, the operator wallet pays gas;
   2. under **Chains**, add a chain and configure it with your factory's address and a settlement token. The address is `KiteFactoryModule#KiteFactoryProxy` in your deployment's `deployed_addresses.json`;
   3. create an **App**, turn on the **Chains** it accepts with an address on each, then create an **API key** for your backend;
   4. create a **Payment link** and open it to pay.

To try it without real funds, set `KITE_IS_TESTNET=true` (see [Testnets](#testnets)).

## Taking payments from your app

The usual integration has three parts:

1. Your backend creates a payment link for the order with [`@kite-01/sdk`](https://github.com/Kite-01/monorepo/tree/main/packages/sdk), setting an optional `reference` to your order id.
2. Your site sends the customer to `/pay/<id>`. To keep them on your page, show `/pay/<id>?embed` in an iframe instead: it posts `ready`, `status`, `success`, `failed` and `close` messages, each with `source: "kite"`, to the page around it.
3. Kite sends a `Transfer` webhook when the payment settles. Your backend verifies it and fulfils the order.

### Authentication

Every API request authenticates in one of two ways:

- **API key**: each request is signed with the key's Ed25519 private key. Send `x-kite-api-key-id`, `x-kite-timestamp` (Unix seconds), `x-kite-nonce` (single use) and `x-kite-signature`, a base64url signature of:

  ```text
  timestamp \n nonce \n METHOD \n path?query \n sha256(body) as hex
  ```

  The key's scopes decide what it can do. `@kite-01/sdk` signs for you.

- **Root key**: `x-kite-root-key`, plus `x-kite-app-id` to act as one app. It can do everything, so keep it to administration.

The checkout routes under `/api/checkout` need no credentials: anyone with a payment link can pay it.

### Webhooks

Add a webhook URL to an app in the dashboard and Kite POSTs to it on every transfer, deposit, recovery and excess-refund event:

```json
{
  "id": "delivery id",
  "eventId": "event id, the same across retries",
  "webhookId": "…",
  "category": "Transfer",
  "previous": { "status": "Processing" },
  "current": { "status": "Settled" },
  "data": { "…": "the transfer, with its quote and payment link" }
}
```

Each delivery carries `X-Kite-Timestamp` and `X-Kite-Signature`, the hex HMAC-SHA256 of `t=<timestamp>&<raw body>` keyed with the webhook's signing secret. `verifyWebhook` in `@kite-01/sdk` checks both. Failed deliveries are retried; use `eventId` to ignore repeats.

### Getting paid on one chain

By default a payment settles to the app's address on the chain it was paid on. To receive every payment in one place, set a payout token and payout address on the app; [NEAR Intents](#what-near-intents-does-in-kite) converts and delivers each payment. Payout tokens are listed at `GET /api/tokens/payouts`. A 1Click API key, set under **Providers**, avoids the extra fee 1Click charges without one ([register here](https://partners.near-intents.org)).

### API reference

The full API is documented at `/openapi`, with the spec at `/openapi/json`. Every operation is named (`paymentLinks.create`, `transfers.get`, …) and says how it authenticates.

## Configuration

All settings come from environment variables, checked at startup:

| Variable                          | Required | Description                                                                      |
| --------------------------------- | -------- | -------------------------------------------------------------------------------- |
| `KITE_PUBLIC_BASE_URL`            | yes      | The public URL of this server, used for provider callbacks and links             |
| `KITE_PG_DB_URL`                  | yes      | Postgres connection URL                                                          |
| `KITE_ENCRYPTION_KEY`             | yes      | 32 random bytes, base64 (`openssl rand -base64 32`); encrypts secrets at rest    |
| `KITE_OPERATOR_MNEMONIC`          | yes      | BIP-39 mnemonic of the operator wallet that settles and refunds transfers        |
| `KITE_ROOT_KEY`                   | yes      | At least 16 characters; signs you into the dashboard and grants full API access  |
| `KITE_PORT`                       |          | Default `3000`                                                                   |
| `KITE_ENABLE_DASHBOARD`           |          | Serve the dashboard. The checkout at `/pay` is served either way. Default `true` |
| `KITE_ENABLE_OPENAPI_UI_SPECS`    |          | Serve `/openapi`. Default `true`                                                 |
| `KITE_ENABLE_OPENAPI_UI_PROVIDER` |          | `scalar` (default) or `swagger`                                                  |
| `KITE_IS_TESTNET`                 |          | Run on testnets instead of mainnets. Default `false`                             |

Provider keys (QuickNode, Alchemy, thirdweb, NEAR Intents, etc) aren't environment variables: set them from the dashboard's **Providers** page, where they're stored encrypted.

### Testnets

Run a separate server with `KITE_IS_TESTNET=true` and its own database. A server without the flag only offers mainnets, so test tokens can never pay a real payment link. Switching the flag on an existing database hides the other kind of chains rather than deleting them. NEAR Intents has no testnet, so a testnet server settles every payment on the chain it was paid on.

## Running in production

```sh
docker build -t kite-server .
docker run -p 3000:3000 --env-file .env kite-server
```

The image builds the dashboard and runs migrations before starting.

## Development

```sh
# API and dashboard with hot reload
bun run dev

# tests, against a throwaway Postgres they start themselves
bun run test

# typecheck
bun run check

# oxlint and Prettier
bun run lint

# typecheck and build the dashboard
bun run build

# apply migrations
bun run migrate

# generate a migration after changing src/db/schema
bun run db:generate

# browse the database
bun run db:studio

# print the OpenAPI spec without a database
bun run spec
```

The code lives in `src/`: routes in `api/`, business logic in `services/`, chain and provider integrations in `sdks/`, the schema in `db/` and migrations in `drizzle/`. The dashboard and checkout are a React app in `client/`. [AGENTS.md](AGENTS.md) has notes for AI coding agents.

## Troubleshooting

- **The server won't start**: it lists any environment variable that's missing or invalid. `KITE_ENCRYPTION_KEY` must decode to exactly 32 bytes.
- **Can't connect to Postgres**: check `KITE_PG_DB_URL`, then run `bun run migrate`.
- **Deposits aren't detected**: deposits are noticed by the deposit notifier set on the chain, or else by a balance check every minute. A notifier needs its keys under **Providers**, and `KITE_PUBLIC_BASE_URL` must be reachable from the internet so it can call back.
- **`Invalid signature`**: sign the exact body you send, and the path with its query string. Clocks must be within five minutes, and each nonce works once.

## NEAR HACKATHON

Kite took part in [NEAR HACKATHON](https://nearhackathon.com), in the Real-World Money and Agent Economy tracks. Kite was already running before the hackathon. What's judged is the NEAR work we added during the hackathon:

- payouts through NEAR Intents ([how they work](#what-near-intents-does-in-kite)), with the apps' payout settings and accepted chains, and payout tracking in the dashboard;
- support for Aurora, NEAR's EVM, with a [Kite factory on its testnet](https://github.com/Kite-01/contracts/blob/main/ignition/deployments/chain-1313161555/deployed_addresses.json).

Tag `pre-hackathon` (commit `84d0343`, the import of the existing code) marks Kite before the hackathon, and `hackathon-submission` the submitted state: [see the diff](https://github.com/Kite-01/server/compare/pre-hackathon...hackathon-submission). Thirdweb gas sponsorship, the Uniswap V2 fallback and the upgradeable factory are in that diff too, but they aren't NEAR work.

## Related repositories

- [Kite-01/contracts](https://github.com/Kite-01/contracts): the `KiteFactory` and `Kite` contracts, published as `@kite-01/contracts` (MIT).
- [Kite-01/monorepo](https://github.com/Kite-01/monorepo): `@kite-01/sdk`, for calling the API and verifying webhooks (MIT).

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, tests and how changes are reviewed.

To report a vulnerability, follow [SECURITY.md](SECURITY.md) rather than opening an issue.

## License

The Kite server is licensed under the [GNU Affero General Public License v3.0](LICENSE), with additional terms in [NOTICE.md](NOTICE.md):

- Every page that shows a payer a payment keeps the "Powered by Kite" notice, linked to [usekite.site](https://usekite.site).
- Modified versions must be marked as modified, and can't be called Kite.
- If you run a modified version for others over a network, the AGPL requires you to offer them its source.

To run Kite without the notice, or under other terms, ask for a commercial license through [usekite.site](https://usekite.site).
