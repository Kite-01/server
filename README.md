<div align="center">
  <img src="client/public/logo.png" alt="Kite logo" width="260" />
</div>

# Kite

Agents can now spend money, and plenty of tools govern what they're allowed to spend. But merchants still have no simple way to get paid by an agent. Kite is a payment link that both people and agents can pay:

- **A person** opens the link and sees a normal checkout: they connect a wallet, or send tokens to an address shown as a QR code or text.
- **An agent** requests the same link and gets it as an HTTP `402 Payment Required` [x402](https://www.x402.org) resource, so it pays with an HTTP request, with no browser or UI.

Kite is an open-source crypto payment processor that a business runs itself. The business creates a payment link, the customer pays it in any token on one of the business's chains, a Kite contract settles the payment on-chain, and a signed webhook tells the business's systems.

A business taking crypto on several chains ends up with balances spread across all of them. With [NEAR Intents](https://docs.near-intents.org/), it can receive every payment as one token at one address, for example USDC on NEAR at `shop.near`, whichever chain and token the customer paid with. NEAR and Aurora are payment chains too.

This repository is the server: the API, the dashboard the business runs it from, and the checkout page customers pay on. The contracts ([EVM](https://github.com/Kite-01/contracts), [NEAR](https://github.com/Kite-01/near-contracts), [Stellar](https://github.com/Kite-01/stellar-contracts), [Gno.land](https://github.com/Kite-01/gno-contracts)) and the [SDK](https://github.com/Kite-01/monorepo) live in their own repositories.

## Try it

Open a payment link to pay as a person, or point your agent at it:

| Network | Price      | Link                                                                    |
| ------- | ---------- | ----------------------------------------------------------------------- |
| Testnet | 1 USD      | <https://testnet.usekite.site/pay/cc4eaa8e-2673-4b5c-af09-c151b1736ffd> |
| Testnet | 1 GBP      | <https://testnet.usekite.site/pay/6c103330-4adc-43a1-9335-084027a3f284> |
| Mainnet | 1 USD      | <https://mainnet.usekite.site/pay/a1b264be-d168-42a9-9a2e-d2b0b0aa0467> |
| Mainnet | 10,000 NGN | <https://mainnet.usekite.site/pay/b42601ba-9cb7-4b94-a2c0-4382526f6bc3> |

To see what an agent sees, request a link as JSON:

```sh
curl -i -H "Accept: application/json" https://testnet.usekite.site/pay/cc4eaa8e-2673-4b5c-af09-c151b1736ffd
```

It answers `402` with an x402 `accepts` list: one offer for each network the agent can pay on, `near:testnet` among them. An x402 client signs one and pays by repeating the request. Kite is its own facilitator: it verifies the signature and settles on-chain itself, paying the gas, so the agent only needs the token.

The hosted dashboards are [testnet.usekite.site](https://testnet.usekite.site) and [mainnet.usekite.site](https://mainnet.usekite.site). Sign in with the demo key `KiteIsDope!!@001`, which can view everything but change nothing. To take payments yourself, create a store at [usekite.site](https://usekite.site).

The testnet server takes payments on NEAR and Aurora. NEAR Intents has no testnet, so payouts through it only run on the mainnet server, which takes payments on NEAR too.

### What NEAR Intents does in Kite

A business sets a **payout token** and **payout address** on its app, for example USDC on NEAR at `shop.near`. Then, for each payment:

1. **The transfer opens**: Kite asks NEAR Intents' 1Click API for a `FLEX_INPUT` quote that converts the paying chain's settlement token into the payout token and delivers it to the payout address. Refunds go to the app's own address on the paying chain.
2. **The customer pays**: the Kite contract settles the payment straight into the quote's deposit address. Kite never holds the business's money: the contract pays Intents directly, and Intents pays the business.
3. **The payout is tracked**: Kite polls 1Click until the payout is delivered (with the delivery transaction), refunded or failed. Each outcome is written to the transfer's timeline and shown in the dashboard.

Destinations are checked when they're set. Kite asks for a dry quote, which moves no money, and 1Click rejects an address it can't deliver to.

A payment settles to the app's address on the paying chain instead when Intents can't take it:

- Intents has no route for the chain or its settlement token.
- 1Click can't quote the payment.

A payment that would settle within 30 minutes of the deposit address's deadline isn't sent there: the transfer fails and the customer is refunded.

### Limitations

What Kite can do on a chain depends on the providers that support it. [`src/shared/chains/registry.ts`](src/shared/chains/registry.ts) lists every supported chain, with the providers that support it under `descriptors`.

- **Agents only pay through payment links**: a store that keeps its own checkout still can't take payments from agents.
- **On chains NEAR Intents doesn't support**, payments settle to the app's address on the paying chain, even when the app has a payout set.
- **On chains without an onchain notifier**, deposits are found by a balance check every minute, and deposit webhooks aren't sent.
- **On chains without a gas sponsor**, the operator wallet pays the gas.
- **x402 needs EIP-3009** on EVM chains: where the settlement token doesn't support it, agents can't pay. On NEAR, agents pay any NEP-141 token with a delegated `ft_transfer`, not native NEAR.
- **NEAR Intents has no testnet**, so payouts only happen on mainnet.
- **NEAR is in beta**, on mainnet and testnet.
- **On NEAR**:
  - Deposits are found by the balance check, as on chains without a notifier.
  - Swap quotes come from Rhea's spot price rather than a time-weighted average, though the deposit contract still enforces the minimum it settles for.
  - A token transfer costs one registration on the pay-in token (about 0.00125 NEAR) when it opens; a native NEAR one costs nothing. The deposit account is only created once there's a payment to settle or refund, and its reserve and registration deposits come back when it's finished.
- **On Stellar:**
  - Deposits are found by the balance check, as on chains without a notifier.
  - The pay-in address is a contract (`C…`). Customers pay with the token's own `transfer`, from a wallet that can send to a contract address, or from the checkout's wallet button (Stellar Wallets Kit: Freighter, xBull, Lobstr, Albedo, Rabet, Hana and others). Classic payments, and most exchanges, can't send to it.
  - A refund can't carry a memo, so a refund to an exchange needs the exchange's `M…` (muxed) address. `M…` addresses are only accepted for Stellar Asset Contract tokens, as a custom SEP-41 token may not support them.
  - Swap quotes come from Soroswap's spot price, as its pairs keep no time-weighted average; the deposit contract still enforces the minimum it settles for. Without a Soroswap router configured for the network, customers can only pay in the settlement token.
  - A payout to a `G…` account that has no trustline for the settlement token fails the settlement, and the payment is refunded.
- **On Gno.land:**
  - Deposits are found by the balance check, as on chains without a notifier.
  - Only GRC20s are swapped. A realm can't wrap or unwrap GNOT (`wugnot` only does so in a user's own transaction), so a link that settles in GNOT is paid in GNOT, and GNOT can't pay a link that settles in a GRC20.
  - The customer pays the gas of the payment, in GNOT. The operator pays for settling and refunding.
  - NEAR Intents has no Gno.land, so payments settle to the app's Gno.land address even when the app has a payout set, and Gno.land can't be a payout destination.
  - x402 takes GNOT only, as [gnolang/x402](https://github.com/gnolang/x402) does, and the agent pays its own gas. An agent can pay with a session key its account registered, within the session's spend limit, expiry and allowed messages.
  - As gnolang/x402 documents, a signed payment doesn't expire: until the payer spends its sequence on another transaction, whoever holds it can broadcast it. And a payer can spend that sequence between verification and settlement, so the settlement fails.

## What Kite does

- **Payment links**: priced in a fiat currency, with optional line items, your own `reference` and `meta`. A link can be one-time or reusable.
- **Checkout**: customers pay by connecting a wallet or by sending tokens to an address, shown as a QR code or text.
- **Agent payments**: a payment link is also an [x402](https://www.x402.org) resource. An agent that requests `/pay/<id>` with GET or POST gets a `402` offering every network that takes x402, signs one and pays by repeating the request.
- **Its own x402 facilitator**: Kite verifies and settles x402 payments itself, with no third-party facilitator. The agent only signs, and never needs gas:
  - on EVM chains it signs an EIP-3009 authorization, which the operator wallet submits, through the gas sponsor where one is set;
  - on NEAR it signs a delegated `ft_transfer`, which the operator relays as a meta transaction;
  - on Stellar it signs a Soroban authorization for one token `transfer`, which Kite's facilitator account submits and the operator fee-bumps.
  - on Gno.land it signs a bank send of GNOT with [`@gnolang/x402`](https://github.com/gnolang/x402), which Kite verifies and broadcasts. This is the one chain where the agent pays its own gas: Gno.land has no fee sponsorship.
  - Your backend can use it too, with an API key scoped to `x402`: `/api/x402/supported`, `/api/x402/pay`, `/api/x402/transfer/<id>/requirements`, `/api/x402/verify` and `/api/x402/settle`.
- **Any token in, your token out**: payments in another token are swapped through Uniswap V3, or V2 where a chain has no V3. They're priced from time-weighted averages, so a pool someone just moved can't skew a quote.
- **Settlement on-chain**: each payment runs through its own [Kite contract](https://github.com/Kite-01/contracts), which settles, pays fees or refunds.
- **Stellar as a chain**: each payment gets its own Soroban contract, at a `C…` address derived from the transfer before anything is deployed, as on the other chains.
  - The address comes from the [factory](https://github.com/Kite-01/stellar-contracts) and a salt, the `sha256` of the transfer's XDR. The customer pays USDC or XLM to it with the token's `transfer`; the factory deploys the contract only once it's paid, and settles in the same transaction.
  - Refunds, fees and payouts can go to `G…`, `C…` or `M…` addresses.
  - Swaps go through Soroswap where a router is configured. Testnet has one, with an XLM/USDC pair.
  - Agents pay with x402: they sign a Soroban authorization for one token transfer, which Kite's facilitator account submits and the operator fee-bumps, so the agent pays no fees.
  - The operator pays every fee itself; there's no gas sponsor.
  - NEAR Intents knows Stellar as `stellar`, with USDC and XLM, so other chains can pay out to Stellar. Stellar payments will pay out through it once Stellar mainnet is added; Intents has no testnet.
- **Gno.land as a chain**: each payment gets its own address, a sub-realm of the [Kite realm](https://github.com/Kite-01/gno-contracts), derived from the transfer before anything happens on-chain.
  - The address is `chain.DerivePkgSubAddr(realm, "t/" + sha256(transfer))`. The customer sends GNOT, or a GRC20, to it with Adena or any wallet; the operator calls the realm's `Settle`, which mints that sub-realm identity, pays the fees and the merchant, and returns any excess. After expiry anyone can call `Refund`.
  - A customer can pay in another GRC20 than the settlement token: `Settle` swaps it on GnoSwap as the deposit address, with a minimum output, before paying anyone.
  - Quotes come from GnoSwap's `DrySwapRoute`, held to the pool's time-weighted price from `Observe`, as on Uniswap. Onyx prices GNOT through a GNOT/tUSD pool, tUSD being a test dollar with a faucet.
  - Agents pay with x402, in GNOT.
- **NEAR as a chain** (beta): on NEAR, each payment gets its own deposit account in the same way, which the customer pays with any NEAR wallet or exchange.
  - The account's id is derived from the transfer, before it exists (a [NEP-616](https://github.com/near/NEPs/pull/616) `0s…` account running the `kite-deposit` global contract).
  - Swaps go through Rhea Finance.
  - Agents pay with x402.
- **Payouts through NEAR Intents**: every payment delivered as one token on one chain
- **Webhooks** for every transfer status change, signed so you can verify them.
- **Apps and API keys**: separate businesses or projects, each with the chains it accepts and an address on each, and scoped API keys.
- **OpenAPI** spec and interactive docs at `/openapi`.
- Fees, chains, tokens and price feeds, all managed from the dashboard.

## Getting started

### With Docker

The quickest way: run the published image, [`ghcr.io/kite-01/server`](https://github.com/Kite-01/server/pkgs/container/server), with its Postgres. You only need Docker.

```sh
mkdir kite && cd kite
curl -fsSLO https://raw.githubusercontent.com/Kite-01/server/main/docker-compose.yml
curl -fsSL -o .env https://raw.githubusercontent.com/Kite-01/server/main/.env.example
```

Set your own `KITE_ENCRYPTION_KEY` (`openssl rand -base64 32`), `KITE_OPERATOR_MNEMONIC` and `KITE_ROOT_KEY` in `.env`, then:

```sh
docker compose up -d
```

The image runs its migrations and serves the API and dashboard at `http://localhost:3000`. Then continue from step 5 below.

| Image tag   | Follows    | Use it for                                          |
| ----------- | ---------- | --------------------------------------------------- |
| `latest`    | `main`     | mainnets                                            |
| `testnet`   | `testnet`  | testnets: also set `KITE_IS_TESTNET=true` in `.env` |
| `sha-<sha>` | one commit | pinning an exact build                              |

Pick the tag with `KITE_IMAGE`, for example `KITE_IMAGE=testnet docker compose up -d`, and update with `docker compose pull && docker compose up -d`.

### From source

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

5. **Deploy your own Kite factory** on each chain you'll take payments on, as described in [Deploying](https://github.com/Kite-01/contracts#deploying) in the contracts repository ([NEAR](https://github.com/Kite-01/near-contracts#deploying-from-scratch), [Stellar](https://github.com/Kite-01/stellar-contracts#deploying-on-testnet), [Gno.land](https://github.com/Kite-01/gno-contracts#deploying-on-testnet)). Make your server's operator wallet its operator. Kite only settles through a factory where its operator wallet holds the operator role, so it refuses anyone else's, ours included.

   The operator wallet comes from `KITE_OPERATOR_MNEMONIC`, with an address on each kind of chain. The dashboard lists them under the settings menu, at the bottom of the sidebar.

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

| Variable                          | Required | Description                                                                                                                                        |
| --------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KITE_PUBLIC_BASE_URL`            | yes      | The public URL of this server, used for provider callbacks and links                                                                               |
| `KITE_PG_DB_URL`                  | yes      | Postgres connection URL                                                                                                                            |
| `KITE_PG_DB_CERTIFICATE`          | no       | CA certificate (PEM) to verify Postgres over TLS; `\n` escapes work. Leave `sslmode` out of the URL when it's set                                  |
| `KITE_ENCRYPTION_KEY`             | yes      | 32 random bytes, base64 (`openssl rand -base64 32`); encrypts secrets at rest                                                                      |
| `KITE_OPERATOR_MNEMONIC`          | yes      | BIP-39 mnemonic of the operator wallet that settles and refunds transfers. On NEAR the operator is the implicit account of its `m/44'/397'/0'` key |
| `KITE_ROOT_KEY`                   | yes      | At least 16 characters; signs you into the dashboard and grants full API access                                                                    |
| `KITE_DEMO_KEY`                   | no       | At least 16 characters; signs into the dashboard view only. It can't change anything or see providers and the KV store                             |
| `KITE_PORT`                       |          | Default `3000`                                                                                                                                     |
| `KITE_ENABLE_DASHBOARD`           |          | Serve the dashboard. The checkout at `/pay` is served either way. Default `true`                                                                   |
| `KITE_ENABLE_OPENAPI_UI_SPECS`    |          | Serve `/openapi`. Default `true`                                                                                                                   |
| `KITE_ENABLE_OPENAPI_UI_PROVIDER` |          | `scalar` (default) or `swagger`                                                                                                                    |
| `KITE_IS_TESTNET`                 |          | Run on testnets instead of mainnets. Default `false`                                                                                               |
| `KITE_PG_POOL_MAX`                |          | Most connections the app's queries hold. Default `10`                                                                                              |
| `KITE_PG_BOSS_POOL_MAX`           |          | Most connections the job queue holds, plus one it keeps for listening. Default `20`                                                                |

Each running instance can hold `KITE_PG_POOL_MAX + KITE_PG_BOSS_POOL_MAX + 1` connections, and a deploy briefly runs two. On a database with few connections, size the pools to fit twice in its limit: with 20, for example, `KITE_PG_POOL_MAX=3` and `KITE_PG_BOSS_POOL_MAX=3`.

On Stellar the operator is the `m/44'/148'/0'` key of `KITE_OPERATOR_MNEMONIC` (SEP-5), and x402 settlements are signed by its `m/44'/148'/1'` key, which needs an account on chain: fund both, on testnet with Friendbot.

On Gno.land the operator is the `m/44'/118'/0'/0/0` key of `KITE_OPERATOR_MNEMONIC`, as gnokey derives it: fund it on testnet from [faucet.gno.land](https://faucet.gno.land).

Provider keys (QuickNode, Alchemy, thirdweb, NEAR Intents, etc) aren't environment variables: set them from the dashboard's **Providers** page, where they're stored encrypted.

### Testnets

Run a separate server with `KITE_IS_TESTNET=true` and its own database. A server without the flag only offers mainnets, so test tokens can never pay a real payment link. Switching the flag on an existing database hides the other kind of chains rather than deleting them. NEAR Intents has no testnet, so a testnet server settles every payment on the chain it was paid on.

## Running in production

Run the published image, [`ghcr.io/kite-01/server`](https://github.com/Kite-01/server/pkgs/container/server), against your own Postgres:

```sh
docker run -p 3000:3000 --env-file .env ghcr.io/kite-01/server:latest
```

It's built for `linux/amd64` and `linux/arm64`, serves the dashboard, and runs migrations before starting. `docker-compose.yml` runs it with a Postgres of its own. To build it yourself instead: `docker build -t kite-server .`.

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

Kite took part in [NEAR HACKATHON](https://nearhackathon.com), in the Real-World Money and Agent Economy tracks. Kite was already running before the hackathon. What's judged is the NEAR work we added during the hackathon, which you can try from [Try it](#try-it):

- payouts through NEAR Intents ([how they work](#what-near-intents-does-in-kite)), with the apps' payout settings and accepted chains, and payout tracking in the dashboard;
- support for Aurora, NEAR's EVM, with a [Kite factory on its testnet](https://github.com/Kite-01/contracts/blob/main/ignition/deployments/chain-1313161555/deployed_addresses.json);
- NEAR itself as a chain Kite runs on, matching the EVM design, in beta on testnet:
  - `factory` and the per-transfer `kite` contracts ([Kite-01/near-contracts](https://github.com/Kite-01/near-contracts)), each transfer at an account derived from it before it exists (NEP-616 with NEP-591 global contracts);
  - settlement through Rhea;
  - NEAR wallets at checkout;
  - x402 on NEAR, with Kite relaying the agent's delegated `ft_transfer`.

Tag `pre-hackathon` (commit `84d0343`, the import of the existing code) marks Kite before the hackathon, and `hackathon-submission` the submitted state: [see the diff](https://github.com/Kite-01/server/compare/pre-hackathon...hackathon-submission). Thirdweb gas sponsorship, the Uniswap V2 fallback and the upgradeable factory are in that diff too, but they aren't NEAR work.

## Related repositories

- [Kite-01/contracts](https://github.com/Kite-01/contracts): the `KiteFactory` and `Kite` contracts, published as `@kite-01/contracts` (MIT).
- [Kite-01/near-contracts](https://github.com/Kite-01/near-contracts): `factory` and `kite`, the same on NEAR (MIT).
- [Kite-01/stellar-contracts](https://github.com/Kite-01/stellar-contracts): `factory` and `kite`, the same on Stellar, as Soroban contracts (MIT).
- [Kite-01/gno-contracts](https://github.com/Kite-01/gno-contracts): the Kite realm and its transfer package on Gno.land (MIT).
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
