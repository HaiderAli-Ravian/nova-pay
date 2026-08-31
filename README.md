# NovaPay

NovaPay is a backend engineering assessment focused on safe financial transfers,
idempotent bulk disbursements, time-locked foreign-exchange quotes, scalable
transaction history, and operational visibility.

All six services compile, own an isolated PostgreSQL schema and migration
history, and expose dependency-aware health and Swagger endpoints with
consistent validation, error responses, request IDs, and structured logging.
Docker Compose supplies restricted databases, authenticated Redis, and a single
Nginx entry point. Account, Transaction, and Ledger provide idempotent wallet
provisioning, authoritative balances, domestic transfer orchestration, atomic
double-entry posting, immutable reversals, replay-safe retries, reconciliation,
and cursor-based wallet history. FX quotes and international transfers add
database-timed expiry, single-use quote consumption, and independently balanced
currency legs. Payroll adds durable bulk-job submission, deterministic BullMQ
work, employer-scoped serialization, exact item checkpoints, and restart-safe
Transaction retries. Account protects restricted identity fields with envelope
encryption, while Admin provides immutable, verifiable audit streams.
All services expose low-cardinality Prometheus metrics and OpenTelemetry traces;
the local stack includes Prometheus, Grafana, an OpenTelemetry Collector, and
Jaeger, plus an immediate critical Ledger invariant alert.

## Architecture

NovaPay is a monorepo containing six independently structured NestJS services:
Account, Transaction, Ledger, FX, Payroll, and Admin. External traffic enters
through Nginx. Services communicate synchronously over HTTP, while BullMQ and
Redis are reserved for asynchronous payroll processing. Each service owns a
separate logical PostgreSQL database; the Ledger Service is the sole source of
financial truth.

```mermaid
flowchart LR
  Client[API client] --> Gateway[Nginx API gateway]

  Gateway --> Account[Account Service]
  Gateway --> Transaction[Transaction Service]
  Gateway --> FX[FX Service]
  Gateway --> Payroll[Payroll Service]
  Gateway --> Admin[Admin Service]

  Transaction --> Account
  Transaction --> FX
  Transaction --> Ledger[Ledger Service]
  Payroll --> Account
  Payroll --> Transaction
  Payroll <--> Queue[Redis and BullMQ]
  Account --> Ledger
  Account --> Admin

  Account --> AccountDB[(account_db)]
  Transaction --> TransactionDB[(transaction_db)]
  Ledger --> LedgerDB[(ledger_db)]
  FX --> FXDB[(fx_db)]
  Payroll --> PayrollDB[(payroll_db)]
  Admin --> AdminDB[(admin_db)]

  Services[All six services] --> Prometheus
  Services --> Collector[OpenTelemetry Collector]
  Collector --> Jaeger
  Prometheus --> Grafana
```

Only the gateway publishes application routes. Internal service endpoints and
all data stores remain on the private Compose network.

## Repository layout

```text
services/   Service applications
infra/      Local infrastructure and observability configuration
postman/    Importable local-review collection, environment, and Compose override
.github/    Service-aware CI/CD workflows
API_EXAMPLES.md  Public gateway request/response and error examples
```

## Prerequisites

- Node.js 22.22.3 or newer (Node.js 24 recommended)
- npm 10 or newer
- Docker Engine with the Compose plugin for the complete local stack

The service containers use Node.js 24. The TypeScript services use native ESM and
are managed through one npm workspace lockfile while retaining independent
service package versions.

## Install, build, and test

```bash
npm ci
npm run prisma:validate
npm run build
npm test
```

Each service can also be checked independently:

```bash
npm run build --workspace @novapay/account-service
npm run test --workspace @novapay/account-service
```

## Run the complete local stack

Create a private local environment file from the ready-to-run local test
defaults, validate the resolved stack, and start it:

```bash
cp .env.example .env
docker compose --env-file .env -f infra/docker-compose.yml config
docker compose --env-file .env -f infra/docker-compose.yml up --build --wait
```

The root `.env.example` is the canonical template for the complete Compose
stack. Files under `services/*/.env.example` are only for running an individual
service directly during development. The committed values are deliberately
local-only test credentials; replace them for any shared or non-local environment.

The database initializer creates six databases and six restricted login roles.
One-shot migration containers must finish successfully before application
containers start. PostgreSQL, Redis, and application service ports remain on the
Compose network; Nginx and the observability interfaces publish documented host
ports.

Useful gateway URLs:

| Resource | URL |
|---|---|
| Gateway health | `http://localhost:8080/health/live` |
| Account health / Swagger | `http://localhost:8080/services/account/health/ready`, `http://localhost:8080/services/account/docs` |
| Transaction health / Swagger | `http://localhost:8080/services/transaction/health/ready`, `http://localhost:8080/services/transaction/docs` |
| Ledger health / Swagger | `http://localhost:8080/services/ledger/health/ready`, `http://localhost:8080/services/ledger/docs` |
| FX health / Swagger | `http://localhost:8080/services/fx/health/ready`, `http://localhost:8080/services/fx/docs` |
| Payroll health / Swagger | `http://localhost:8080/services/payroll/health/ready`, `http://localhost:8080/services/payroll/docs` |
| Admin health / Swagger | `http://localhost:8080/services/admin/health/ready`, `http://localhost:8080/services/admin/docs` |
| Prometheus | `http://localhost:9090` |
| Grafana | `http://localhost:3000` |
| Jaeger | `http://localhost:16686` |

Stop the stack without deleting persisted data:

```bash
docker compose --env-file .env -f infra/docker-compose.yml down
```

Changing database passwords after first initialization requires an intentional
volume reset. `docker compose ... down --volumes` deletes all local NovaPay data.

## Run one service during development

```bash
npm run start:dev --workspace @novapay/account-service
```

Copy that service's `.env.example` to an untracked `.env` or export its values.
Every service requires its own `DATABASE_URL`; Payroll additionally requires a
`REDIS_URL` (a password is optional for local Redis), and Transaction requires a
32-byte base64 `HISTORY_CURSOR_HMAC_KEY` (`openssl rand -base64 32`). When running
the Collector and services outside Compose, set
`OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`; tracing is disabled when the
variable is omitted. A valid process stays live when a dependency is down,
but `/health/ready` returns `503 SERVICE_NOT_READY` until dependencies recover.

The default service ports are:

| Service | Port | Health | Swagger |
|---|---:|---|---|
| Account | 3001 | `/health/live`, `/health/ready` | `/docs` |
| Transaction | 3002 | `/health/live`, `/health/ready` | `/docs` |
| Ledger | 3003 | `/health/live`, `/health/ready` | `/docs` |
| FX | 3004 | `/health/live`, `/health/ready` | `/docs` |
| Payroll | 3005 | `/health/live`, `/health/ready` | `/docs` |
| Admin | 3006 | `/health/live`, `/health/ready` | `/docs` |

Override a service port with `PORT`. `NODE_ENV` accepts `development`, `test`,
or `production`; invalid startup configuration fails immediately.

## Public API examples

[API_EXAMPLES.md](API_EXAMPLES.md) contains gateway-based request and response
examples for every public business endpoint, the operational health/Swagger
surfaces, authentication conventions, and material error codes.

## Postman collection

Import both files into Postman and select the `NovaPay Local Review`
environment:

- `postman/NovaPay.postman_collection.json`
- `postman/NovaPay.local.postman_environment.json`

For a fresh reviewer run, copy `.env.example` to `.env` and start the local
review profile:

```bash
docker compose --env-file .env \
  -f infra/docker-compose.yml \
  -f postman/docker-compose.yml \
  up --build --wait
```

Run the collection in its numbered order. It creates the Alice/Bob wallets,
stores encrypted test identity data, captures every generated ID, applies one
idempotent funding fixture, and then exercises domestic replay, FX,
international transfer, payroll, audit, history, and health requests. No
Postman variable needs editing when `.env` was copied from `.env.example`.
The clean-stack verification executes 27 requests and 55 assertions with no
failures, including a completed background payroll item.

The Postman override binds Ledger only to `127.0.0.1:3003` and enables its
controlled funding route in development mode. The normal Compose stack keeps
that route disabled and Ledger unpublished. If using an existing custom `.env`,
set the Postman `internalServiceToken` variable to the same local token.

Stop and remove only the local review stack with:

```bash
docker compose --env-file .env \
  -f infra/docker-compose.yml \
  -f postman/docker-compose.yml \
  down --volumes
```

## Build a service image

Use the repository root as the Docker build context:

```bash
docker build \
  -f services/account-service/Dockerfile \
  -t nova-pay/account-service:0.5.0 \
  .
```

Each image uses a multi-stage Node.js 24 Alpine build and runs as the non-root
`node` user. The Dockerfiles also expose a dedicated one-shot `migration` target
used by Compose before service startup.

## Domestic transfers and retries

The Transaction Service accepts a development principal through
`Authorization: Bearer <principal>` and requires a unique `Idempotency-Key` for
each intended transfer. A request uses wallet IDs created by Account:

```bash
curl -X POST http://localhost:8080/transfers \
  -H 'Authorization: Bearer alice' \
  -H 'Idempotency-Key: transfer-2026-08-30-001' \
  -H 'Content-Type: application/json' \
  -d '{"senderWalletId":"34c25a45-3293-41bb-9f56-6ef234f53394","recipientWalletId":"d72ba34e-2391-4916-b039-c856ace82b9e","amount":"100.00000000","currency":"USD"}'
```

A completed response is stored for replay:

```json
{
  "transferId": "9a459c61-392e-453f-a08d-3d684e6be503",
  "status": "COMPLETED",
  "sourceAmount": "100.00000000",
  "sourceCurrency": "USD",
  "targetAmount": "100.00000000",
  "targetCurrency": "USD",
  "ledgerTransactionId": "8b489805-7c56-4d51-9358-bbcf78204e97",
  "completedAt": "2026-08-30T10:01:00.000Z"
}
```

Retry behavior is protected by Transaction and Ledger database constraints:

- Repeating the same key and canonical payload returns the original transfer;
  simultaneous duplicates have one database winner and one Ledger posting.
- A Ledger commit followed by a lost HTTP response remains `PROCESSING` until
  reconciliation finds the posting by the stable transfer ID and completes it.
- After the 24-hour replay window, the retained key tombstone returns
  `409 IDEMPOTENCY_KEY_EXPIRED` without moving money again.
- Reusing a key with a different canonical payload returns
  `409 IDEMPOTENCY_PAYLOAD_MISMATCH` and leaves the original transfer unchanged.
- Insufficient funds and other definitive failures are stored and replayed.

Transfer status is available at `GET /transfers/:transferId`. Wallet history is
available at `GET /wallets/:walletId/transactions?limit=50&cursor=...` and uses an
HMAC-authenticated, wallet-bound cursor over the indexed timestamp/ID ordering
rather than deep offsets. Pages use tuple seek and `limit + 1`, select only the
history projection, and never recalculate balances or query Ledger. Repair the
projection from Transaction-owned transfer rows with:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/transaction_db \
npm run history:rebuild --workspace @novapay/transaction-service
```

A local warm-cache profile over 25,000 projection rows completed 20,000 direct
service/database page reads at concurrency 8 with zero errors, 5,075.09
requests/second, p95 2.67 ms, and p99 2.96 ms. This is bounded implementation
evidence, not a production capacity claim: it excludes Nginx/HTTP, the Account
authorization network hop, and multi-service contention.

## FX quotes and international transfers

Every quote request calls the provider abstraction and persists its exact rate,
amounts, provider reference, database issue time, and expiry exactly 60 seconds
later:

```bash
curl -X POST http://localhost:8080/fx/quote \
  -H 'Authorization: Bearer alice' \
  -H 'Content-Type: application/json' \
  -d '{"sourceCurrency":"USD","targetCurrency":"EUR","sourceAmount":"100.00000000"}'
```

Use the returned `quoteId` once with the matching owner, amount, and currencies:

```bash
curl -X POST http://localhost:8080/transfers/international \
  -H 'Authorization: Bearer alice' \
  -H 'Idempotency-Key: international-2026-08-30-001' \
  -H 'Content-Type: application/json' \
  -d '{"senderWalletId":"34c25a45-3293-41bb-9f56-6ef234f53394","recipientWalletId":"27eed329-3aaf-4713-9ed7-a607781766b5","sourceAmount":"100.00000000","sourceCurrency":"USD","targetCurrency":"EUR","quoteId":"e7ac7ee1-3834-4a09-8ac5-8524384314d3"}'
```

Consumption uses database time and a conditional update. The same transfer ID
may safely retry; another consumer receives `409 QUOTE_ALREADY_USED`, and an
expired quote receives `409 QUOTE_EXPIRED`. Once consumed, a quote is never
released after downstream failure. Ledger stores the quote ID/rate on the
transaction and all four entries, balancing source and target currencies
independently through clearing accounts. Provider failure returns
`503 FX_PROVIDER_UNAVAILABLE` and creates no cached or stale substitute quote.

## Payroll jobs

Submit up to 15,000 uniquely identified payments. The complete request is
canonicalized, the job and its items are committed before enqueue, and the
returned job UUID is also the deterministic BullMQ job ID:

```bash
curl -X POST http://localhost:8080/payroll/jobs \
  -H 'Authorization: Bearer employer-a' \
  -H 'Idempotency-Key: payroll-2026-08-001' \
  -H 'Content-Type: application/json' \
  -d '{"sourceWalletId":"c5511d5e-7bea-4215-a86a-dac725114b25","currency":"USD","items":[{"externalItemId":"employee-001-2026-08","recipientWalletId":"d72ba34e-2391-4916-b039-c856ace82b9e","amount":"2500.00000000"}]}'
```

Read progress with `GET /payroll/jobs/:jobId`. The response reports pending,
processing, completed, and failed counts plus bounded safe failure summaries.
Workers process deterministic batches while holding a renewable Redis lease per
employer. Each item is claimed with an ownership token and calls Transaction
with `payroll:{jobId}:{itemId}` as its stable idempotency key. A committed item
checkpoint and its job counter update occur in one PostgreSQL transaction.

BullMQ applies five bounded exponential-backoff attempts and retains failed jobs
for inspection. Nonterminal database jobs are re-enqueued after restart. If a
Transaction response is lost, the worker repeats the same item key and receives
the original transfer rather than paying twice. If Redis is unavailable during
submission, the durable job remains recoverable and the API returns
`503 QUEUE_UNAVAILABLE`.

## Encrypted identity and audit integrity

`PUT /users/me/identity` accepts only legal name, email, phone, postal address,
and government/tax identifier fields. Account canonicalizes the payload,
generates a random per-record 256-bit DEK, encrypts it with AES-256-GCM, and
wraps that DEK with the configured versioned KEK. Associated data binds both
layers to the user ID and schema version. PostgreSQL stores only ciphertext,
96-bit nonces, authentication tags, the wrapped DEK, key version, and a separate
HMAC-SHA-256 email lookup digest. `GET /users/me/identity` derives ownership only
from the bearer principal.

Admin appends service and operator events through a locked per-stream head.
Each SHA-256 record hash covers a domain tag, previous hash, sequence, occurrence
time, canonical identifiers, and sanitized metadata. Audit records reject
updates, deletes, and truncation at the database layer. Operators use a distinct
`operator:<id>` bearer scope and can verify a stream with
`POST /admin/audit/verify`; reads and verification actions create deterministic,
sanitized audit events. Hash verification detects modification, deletion, or
reordering but does not claim protection against a privileged attacker replacing
all storage and external backups.

## Observability

Each service exposes `/metrics` directly on its internal service port. Prometheus
scrapes HTTP request totals and duration histograms with only bounded `service`,
`method`, route-template, and status-class labels. The supplied Grafana dashboard
shows successful and failed Transaction request rates, API p95/p99 latency, and
the current Ledger invariant violation count. Request, user, wallet, transaction,
and quote identifiers are never metric labels.

Ledger verifies persisted double-entry groups at startup and every 15 seconds by
default (`LEDGER_INVARIANT_INTERVAL_MS`). It stores each check, publishes
`novapay_ledger_invariant_violations`, and Prometheus fires the critical
`LedgerInvariantViolation` alert immediately when the value is above zero.

When `OTEL_EXPORTER_OTLP_ENDPOINT` is configured, Node.js auto-instrumentation
captures inbound HTTP, outbound HTTP, PostgreSQL, Redis, and BullMQ-related work.
Payroll propagates W3C trace context through job data, and the FX provider call has
an explicit `fx.provider.rate` span. Relevant JSON logs include UTC timestamp,
request ID, trace ID, user ID when known, and transaction ID when known; payloads,
credentials, encryption keys, and decrypted identity fields are excluded.

To verify the stack after Compose starts:

1. Run a transfer, then select `transaction-service` in Jaeger and inspect its
   downstream HTTP/database spans.
2. Configure the deterministic FX provider failure control, request a quote, and
   confirm the `fx.provider.rate` span ends in error without a Ledger settlement.
3. Open the provisioned `NovaPay Overview` Grafana dashboard and confirm request
   rate and latency panels populate.
4. Run `POST /internal/ledger/invariants/verify` with the internal service token;
   a healthy database reports zero violations. Exercise the nonzero alert path
   only with the isolated integration-test fixture, never by corrupting a
   development database.

## Continuous integration

The `Validation` workflow calculates the comparison base for pull requests and
pushes, maps changed paths to a stable service matrix, and safely selects every
service when history or shared impact is ambiguous. Documentation-only changes
skip service builds. Any change under a service directory must increase that
service's semantic version relative to the base revision.

Each selected service receives an isolated PostgreSQL database and Redis,
applies its own migrations, runs its database/queue-enabled test suite, compiles,
and builds an image tagged `nova-pay/<service>:<package-version>`. Infrastructure
changes additionally validate Compose, Prometheus rules, Collector configuration,
the Grafana dashboard, and Nginx configuration. The stable `Required validation`
job fails when detection, any selected service, or infrastructure validation
fails; configure that exact job as the required branch-protection check. The
workflow has read-only repository permissions and does not publish images or use
registry credentials.

## Persistence boundaries

- `account_db` owns users and wallet metadata, never balances.
- `transaction_db` owns transfer lifecycle, idempotency records, and history.
- `ledger_db` owns ledger accounts, postings, entries, and balance projections.
- `fx_db` owns immutable 60-second quotes and consumption state.
- `payroll_db` owns durable jobs, item checkpoints, and idempotency records.
- `admin_db` owns audit streams and hash-chain records.

Cross-service identifiers are UUID scalars without cross-database foreign keys.
Money uses PostgreSQL `NUMERIC(28,8)` and FX rates use `NUMERIC(28,12)`; the
application clients expose both as Prisma `Decimal` values.

## Remaining release verification

- Verify tracked-file hygiene, branch protection, and the live workflow on the public repository.
