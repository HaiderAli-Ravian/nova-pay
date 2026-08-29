# NovaPay

NovaPay is a backend engineering assessment focused on safe financial transfers,
idempotent bulk disbursements, time-locked foreign-exchange quotes, scalable
transaction history, and operational visibility.

The repository is currently in the architecture and planning stage. Application
services, infrastructure configuration, API examples, and run instructions will
be added in their corresponding implementation phases.

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
