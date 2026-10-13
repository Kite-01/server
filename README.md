# Kite server

Payment processing service: quotes, transfers, x402, webhooks, an HTTP API and an admin dashboard.

## Setup

```bash
npm install
cp .env.example .env    # set KITE_ROOT_KEY to any string of 16+ characters, e.g. `openssl rand -base64 32`
npm run db:migrate
npm run dev             # API on PORT
npm run dashboard:dev   # dashboard with live reload on :5173
```

In dev the dashboard runs on its own port and Vite proxies `/api` to the API, using `PORT` from `.env` (override with `KITE_API_URL`). Sign in with the value of `KITE_ROOT_KEY`.

No local Postgres? `npm run dev:db` starts one under `.kite/` and prints its URL for `KITE_PG_DB_URL`.

Production: `npm run dashboard:build && npm run build && npm start`. The API serves `dashboard/dist` at `/` when `KITE_ENABLE_DASHBOARD=true` and returns 404 there otherwise.

## Configuration

| Variable                          |                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `KITE_PUBLIC_BASE_URL`            | Public URL of this server; used for provider callbacks                                                              |
| `KITE_PG_DB_URL`                  | Postgres connection string                                                                                          |
| `KITE_ENCRYPTION_KEY`             | 32 bytes, base64. Encrypts webhook signing keys and secret KV values                                                |
| `KITE_OPERATOR_MNEMONIC`          | Operator wallet                                                                                                     |
| `KITE_ROOT_KEY`                   | Root key: any string of 16+ characters. Sent as `x-kite-root-key`; it is also what you enter on the dashboard login |
| `KITE_ENABLE_DASHBOARD`           | Serve the dashboard at `/` (default `true`)                                                                         |
| `KITE_ENABLE_OPENAPI_UI_SPECS`    | Serve `/openapi` and `/openapi/json` (default `true`)                                                               |
| `KITE_ENABLE_OPENAPI_UI_PROVIDER` | `scalar` or `swagger` (default `scalar`)                                                                            |
| `PORT`                            | Default `3000`                                                                                                      |
| `OTEL_EXPORTER_OTLP_ENDPOINT`     | Enables OpenTelemetry traces. `OTEL_SERVICE_NAME` names the service (default `kite`)                                |

## API authentication

**Root key.** Send `x-kite-root-key: <KITE_ROOT_KEY>`. It can call every endpoint under `/api`, and acts as an app when `x-kite-app-id` is also set. It travels in a header on every request, so serve the API over HTTPS and keep it out of logs. Request headers are not exported to OpenTelemetry (only a small allowlist is).

```bash
curl localhost:3000/api/admin/apps -H "x-kite-root-key: $KITE_ROOT_KEY"
```

**API keys.** Created from a client-generated Ed25519 key pair; the server stores the public key only. Every request carries `x-kite-api-key-id`, plus either:

- **a signature**: `x-kite-timestamp` (unix seconds, within 5 minutes), `x-kite-nonce` (8-128 chars of `A-Za-z0-9_-`, single use) and `x-kite-signature`, the base64url Ed25519 signature of

  ```
  timestamp \n nonce \n METHOD \n /path?query \n sha256hex(body)
  ```

- **the public key** (`x-kite-public-key`), accepted only on endpoints marked public: reading the app, chains, tokens, a customer, a payment link, a quote or a transfer, creating a quote from a payment link, and opening a transfer for such a quote.

## Tests

```bash
npm test
```

Tests run against a real Postgres started with `embedded-postgres` (set `KITE_TEST_DATABASE_URL` to use your own server instead) with the migrations in `drizzle/` applied.
