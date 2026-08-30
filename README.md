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
and cursor-based wallet history. FX execution, Payroll workers, and observability
backends remain planned work.

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
Every service requires its own `DATABASE_URL`; Payroll additionally requires an
authenticated `REDIS_URL`. A valid process stays live when a dependency is down,
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
opaque cursor over the indexed timestamp/ID ordering rather than deep offsets.

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

- FX quote expiry and single-use behavior
- Payroll concurrency and resumability
- Audit hash-chain verification
- Observability and alerting
- Time-pressure tradeoffs and production improvements
