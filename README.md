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
Observability backends remain planned work.

## Architecture

NovaPay is a monorepo containing six independently structured NestJS services:
Account, Transaction, Ledger, FX, Payroll, and Admin. External traffic enters
through Nginx. Services communicate synchronously over HTTP, while BullMQ and
Redis are reserved for asynchronous payroll processing. Each service owns a
separate logical PostgreSQL database; the Ledger Service is the sole source of
financial truth.

## Repository layout

```text
services/   Service applications
infra/      Local infrastructure and observability configuration
.github/    Service-aware CI/CD workflows
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

Create a private local environment file from the safe placeholders, replace every
value, validate the resolved stack, and start it:

```bash
cp infra/.env.example infra/.env
docker compose --env-file infra/.env -f infra/docker-compose.yml config
docker compose --env-file infra/.env -f infra/docker-compose.yml up --build --wait
```

The database initializer creates six databases and six restricted login roles.
One-shot migration containers must finish successfully before application
containers start. Only Nginx publishes a host port; PostgreSQL, Redis, and service
ports remain on the Compose network.

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

Stop the stack without deleting persisted data:

```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml down
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
32-byte base64 `HISTORY_CURSOR_HMAC_KEY` (`openssl rand -base64 32`). A valid process stays live when a dependency is down,
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

## Build a service image

Use the repository root as the Docker build context:

```bash
docker build \
  -f services/account-service/Dockerfile \
  -t nova-pay/account-service:0.3.0 \
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

## Documentation still to complete with implementation

- Observability and alerting
- Time-pressure tradeoffs and production improvements
