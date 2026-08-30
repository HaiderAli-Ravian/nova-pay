# NovaPay

NovaPay is a backend engineering assessment focused on safe financial transfers,
idempotent bulk disbursements, time-locked foreign-exchange quotes, scalable
transaction history, and operational visibility.

All six services compile, own an isolated PostgreSQL schema and migration
history, and expose dependency-aware health and Swagger endpoints with
consistent validation, error responses, request IDs, and structured logging.
Docker Compose supplies restricted databases, authenticated Redis, and a single
Nginx entry point. Account and Ledger provide idempotent wallet provisioning,
authoritative balances, atomic double-entry posting, and immutable reversals.
Payroll workers and observability backends remain planned work.

## Planned architecture

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

## Documentation to complete with implementation

- Architecture and service boundaries
- Setup and run instructions
- API endpoint summary and request/response examples
- Swagger URLs
- Five idempotency scenarios
- Double-entry invariant
- FX quote expiry and single-use behavior
- Payroll concurrency and resumability
- Audit hash-chain verification
- Observability and alerting
- Time-pressure tradeoffs and production improvements
