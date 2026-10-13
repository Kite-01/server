<div align="center">
  <img src="client/public/logo.png" alt="Kite logo" width="260" />
</div>

# Kite

Kite is an open-source crypto payment processor for businesses that want to accept digital assets through payment links, checkout flows, API-driven transfers, and a dashboard for monitoring activity. The server exposes a Bun + Elysia API and ships with an embedded React dashboard and public checkout experience.

It is designed around a few core ideas:

- Accept payments through payment links and checkout pages
- Quote and settle transfers across supported chains and tokens
- Manage app-level configuration, API keys, webhooks, and pricing feeds
- Expose a modern dashboard and OpenAPI specs for local or hosted integrations
- Operate with signed request authentication and app-scoped access control

## Why Kite

Kite helps teams build crypto-native commerce experiences without building a full payment backend from scratch.

Typical use cases include:

- Selling digital products or subscriptions in crypto
- Creating branded payment links for customers
- Supporting deposit or payout flows for on-chain transfers
- Managing app configuration and payment lifecycle in one system
- Connecting external systems with a REST API and webhook-based events

## Product architecture

```mermaid
flowchart LR
    User[Customer / Merchant] --> Dashboard[React Dashboard]
    User --> Pay[Public Checkout / Pay Page]
    Dashboard --> API[Kite API]
    Pay --> API
    API --> DB[(Postgres)]
    API --> Chain[Supported EVM Chains]
    API --> PriceFeeds[Price feed / token metadata]
    API --> Webhooks[Webhook notifications]
    API --> OpenAPI[OpenAPI / Scalar / Swagger UI]
```

## Key capabilities

- App and merchant management
- Payment links with catalog line items and pricing
- Checkout quote and transfer creation for supported tokens/chains
- X402 payment flows and settlement support
- Chain and token configuration management
- Fee calculation and policy enforcement
- Dashboard overview, stats, and recent events
- API key, customer, webhook, and KV infrastructure
- Static front-end hosting for the dashboard and public pay page

## Tech stack

- Runtime: Bun
- API: Elysia
- Database: PostgreSQL via Drizzle ORM
- Frontend: React + Vite + TanStack Query
- Auth: signed headers and app-scoped access checks
- Contract integration: viem + generated contract wrappers
- Docs: OpenAPI + Scalar/Swagger UI

## Repository layout

```text
.
├── Dockerfile
├── package.json
├── tsconfig.json
├── drizzle/
├── src/
│   ├── api/
│   ├── db/
│   ├── schemas/
│   ├── sdks/
│   ├── services/
│   ├── shared/
│   └── test/
├── client/
│   ├── src/
│   ├── public/
│   └── vite.config.ts
├── README.md
└── ...
```

## Requirements

Before running Kite locally, make sure you have:

- Bun installed
- PostgreSQL running and reachable
- A public base URL for callbacks and docs
- A valid 32-byte base64 encryption key
- A valid BIP39 mnemonic for operator wallet signing
- A root key for admin authentication

## Environment configuration

Create a local environment file based on these variables:

```env
KITE_PORT=3000
KITE_PUBLIC_BASE_URL=https://your-domain.example.com
KITE_PG_DB_URL=postgresql://postgres:postgres@localhost:5432/kite
KITE_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
KITE_OPERATOR_MNEMONIC="your twelve or twenty four word mnemonic"
KITE_ROOT_KEY=super-secret-root-key
KITE_ENABLE_DASHBOARD=true
KITE_ENABLE_OPENAPI_UI_SPECS=true
KITE_ENABLE_OPENAPI_UI_PROVIDER=scalar
```

Notes:

- `KITE_ENCRYPTION_KEY` must decode to exactly 32 bytes.
- `KITE_PUBLIC_BASE_URL` is used for callback URLs and public docs.
- `KITE_ENABLE_OPENAPI_UI_PROVIDER` can be `scalar` or `swagger`.
- The server validates these values at startup with Zod.

## Quick start

### 1) Install dependencies

```bash
bun install
```

### 2) Prepare the database

Run the migrations:

```bash
bun run db:migrate
```

If you need to generate new schema files after changes:

```bash
bun run db:generate
```

### 3) Start the API in development mode

```bash
bun run dev
```

This starts the Bun server with the API and dashboard assets served when built.

### 4) Build the app

```bash
bun run build
```

This runs the TypeScript check and builds the client bundle.

### 5) Run tests

```bash
bun run test
```

## Dashboard and public checkout

The project includes a React dashboard served from the server when `KITE_ENABLE_DASHBOARD=true`.

Dashboard features include:

- Overview page with stats and recent activity
- Apps and app-scoped configuration
- Payment links management
- Quotes and transfers
- Price feeds and chains
- Webhooks, customers, and API keys
- KV store access for app metadata

The public checkout is also served by the app, with routes such as:

- `/pay/:id`
- `/openapi`
- `/openapi/json`
- `/`

The front-end is bundled into the server under `client/dist`, and the server serves it through the dashboard routes.

<div align="center">
  <img src="client/public/icon.svg" alt="Kite icon" width="96" />
</div>

## API overview

The server exposes most business functionality under the `/api` prefix. Core modules include:

- `GET /api/apps`
- `POST /api/apps`
- `GET /api/payment-links`
- `POST /api/payment-links`
- `GET /api/checkout/:id`
- `POST /api/checkout/:id/quote`
- `POST /api/checkout/:id/transfer`
- `POST /api/checkout/:id/x402`
- `GET /api/overview/stats`
- `GET /api/overview/events`
- `GET /api/chains`
- `GET /api/tokens`
- `GET /api/fees`

The OpenAPI UI is available at:

```text
${KITE_PUBLIC_BASE_URL}/openapi
```

and the JSON spec at:

```text
${KITE_PUBLIC_BASE_URL}/openapi/json
```

## Authentication and authorization

Kite uses request signing and scoped access control.

### Headers used for protected routes

- `x-kite-root-key`
- `x-kite-app-id`
- `x-kite-api-key-id`
- `x-kite-public-key`
- `x-kite-signature`
- `x-kite-timestamp`
- `x-kite-nonce`

You can use root-key access for administrative flows or an app-scoped API key for per-app operations. The middleware enforces both app identity and required scopes.

## Payment flow

A typical payment flow looks like this:

1. Create a payment link or app
2. Configure the chain and tokens supported by that app
3. Fetch the checkout details for a payment link
4. Quote the payment in a supported token
5. Open a transfer or x402 payment flow
6. Track the transfer status via checkout or transfer endpoints
7. Receive webhooks and event updates for the transaction lifecycle

## Webhooks and events

The system records events and can emit webhook notifications for significant payment lifecycle changes. This is useful for reconciling on-chain events with your own back-office systems.

## Docker

The project includes a Dockerfile that builds the client bundle and serves the combined app in production.

```bash
docker build -t kite-server .
docker run -p 3000:3000 --env-file .env kite-server
```

The container runs migrations automatically before starting the app:

```bash
bun src/db/migrate.ts && exec bun src/index.ts
```

## Local development notes

- The server uses `bun --watch src/index.ts` for local development.
- The front-end is built with Vite and bundled into `client/dist`.
- If you are changing dashboard behavior, run the client build step so the server serves the updated static assets.
- The app uses timezone-aware stats and dashboard event queries.

## Common commands

```bash
# install dependencies
bun install

# type-check
bun run check

# lint
bun run lint

# build client + run type-check
bun run build

# start local server
bun run dev

# migrate database
bun run db:migrate

# open Drizzle studio
bun run db:studio

# run tests
bun run test
```

## Troubleshooting

### Postgres connection issues

- Check that Postgres is running and the `KITE_PG_DB_URL` is reachable.
- Ensure the DB user has access to the target database.
- Run migrations after creating the database.

### Dashboard not loading

- Confirm `KITE_ENABLE_DASHBOARD=true`.
- Make sure the client bundle exists under `client/dist`.
- Rebuild the client with `bun run build`.

### OpenAPI docs not appearing

- Set `KITE_ENABLE_OPENAPI_UI_SPECS=true`.
- Use `KITE_ENABLE_OPENAPI_UI_PROVIDER=scalar` or `swagger`.

### Security and signing issues

- Verify your `x-kite-signature` payload matches the request format and body hash.
- Ensure timestamps are fresh and your app key or root key is valid.
- Confirm `KITE_PUBLIC_BASE_URL` is the public origin your SDKs and callbacks expect.

## Contribution guide

Contributions are welcome.

1. Fork the repository.
2. Create a feature branch.
3. Make focused changes with tests where relevant.
4. Run the relevant checks:
   ```bash
   bun run check
   bun run test
   ```
5. Open a pull request with a clear explanation of the change.

## License

This project is licensed under the ISC license. See the project package metadata for the canonical license declaration.

## Project status

Kite is a full-stack crypto payment platform in active development. The codebase includes backend services, a dashboard, checkout tooling, event tracking, and API primitives for production-style integration.

For the most current routing, auth, and contract behavior, use the server source and generated OpenAPI docs as the source of truth.
