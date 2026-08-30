# NovaPay Engineering Decisions

This document records the decisions that materially affect correctness, reliability, and assessment scope. It will be updated as implementation evidence becomes available.

## Architecture

NovaPay uses six independently packaged NestJS services in one npm-workspace monorepo: Account, Transaction, Ledger, FX, Payroll, and Admin. The services use native ESM, share one deterministic root lockfile, and retain independent package versions, tests, and Docker images. Transaction is currently `0.6.0`; Account and Ledger are `0.5.0`; FX, Payroll, and Admin are `0.4.0`. The boundaries match data ownership and system responsibilities without adding a runtime shared package.

All external traffic enters through Nginx. Immediate request/response operations use synchronous HTTP. BullMQ and Redis are limited to asynchronous payroll processing. The design intentionally excludes Kafka, RabbitMQ, a general event bus, Kubernetes, GraphQL, and saga frameworks because they are not required to protect the central financial invariant and would add operational paths that cannot be justified within the assessment.

## Database ownership and financial authority

The local environment runs one PostgreSQL server with six logical databases: one owned by each service. Service credentials and code prohibit direct access to another service's database, and there are no cross-database foreign keys.

Prisma 7.10 is pinned independently in every service with a service-local generated client, schema, and migration history. Initial migrations use PostgreSQL-native check constraints and partial unique indexes where the Prisma schema cannot express the approved invariant directly. Compose applies migrations through one-shot containers and starts each service only after its migration completes; readiness then performs a live `SELECT 1`. Payroll readiness also sends an authenticated Redis `PING`.

Nginx is the only component with a published host port. PostgreSQL, authenticated Redis, and all service ports stay private to the Compose network. Public business path families route to their owning services, explicit health/Swagger routes support operations, and any path containing an `internal` segment is denied at the gateway.

Account owns user and wallet metadata. Ledger owns ledger accounts, immutable entries, and authoritative balance projections. Account balance endpoints call Ledger synchronously and never store a competing balance. Cross-service relationships use stable identifiers validated through service APIs.

## Double-entry invariant and balance locking

Every posting is balanced per currency: total debits equal total credits. Ledger receives all entries for one money movement and performs the following in a single PostgreSQL transaction:

1. Claim a unique external transfer reference.
2. Lock every affected balance row in deterministic order.
3. Check available funds after acquiring the lock.
4. Insert every debit and credit entry.
5. Verify per-currency debit and credit totals.
6. Update authoritative balance projections by the same amounts.
7. Commit the complete posting.

A crash before commit rolls back the debit, credit, and balance changes together. A lost response after commit is safe because retrying the same external reference returns the existing identical posting. Concurrent debits from one wallet serialize on its balance row, so two requests cannot both spend the same funds. Ledger entries are not edited; a correction is a new balanced reversal.

Cross-currency transfers balance each currency independently through internal FX clearing accounts. The source leg debits the sender and credits source clearing; the target leg debits target clearing and credits the recipient.

## Idempotency Scenario A — repeated key

Transaction stores a database record unique on authenticated client and idempotency key. The record contains a canonical request hash, transfer ID, processing state, and sanitized replay response. Repeating the same key and payload returns the existing processing/final result. It does not create another transfer or debit.

## Idempotency Scenario B — simultaneous requests

The unique PostgreSQL index, rather than an application mutex, decides the winner. Three concurrent inserts for the same client/key contend on that unique value. Exactly one transaction commits the idempotency record and transfer. The losing inserts receive a unique-constraint conflict, then read the winner:

- if the request hash differs, the loser receives a payload-mismatch conflict;
- if the hash matches and work is in progress, the loser receives the existing transfer ID with `202 Processing`;
- if the hash matches and work is terminal, the stored outcome is replayed.

Ledger independently enforces one posting per transfer external reference. These two database barriers ensure exactly one money movement even if an orchestration retry occurs after the initial key claim.

## Idempotency Scenario C — crash between debit and credit

There is no committed state in which only one side exists. Ledger inserts both entries and updates balances in one local transaction. A process or database error before commit rolls everything back.

If Ledger commits but Transaction loses the HTTP response, the transfer may temporarily remain `PROCESSING`. Recovery queries Ledger by the stable transfer reference. A found posting marks the transfer `COMPLETED`; an absent posting can be retried with the same reference. Recovery never invents a second financial instruction.

## Idempotency Scenario D — retry after 24 hours

The replayable response expires after 24 hours, but the unique financial-key tombstone is retained under the audit/financial retention policy. A retry at hour 30 returns `409 IDEMPOTENCY_KEY_EXPIRED` and does not initiate another transfer. An intentional new instruction requires a new idempotency key.

This favors financial safety over recycling a client key. Deleting the record at hour 24 would allow a buggy delayed retry to duplicate the movement.

## Idempotency Scenario E — same key, different payload

Before persistence, Transaction validates and canonicalizes the authenticated client, method, route semantics, and normalized DTO, then stores a SHA-256 request hash. If `key-abc` first represents `500.00` and later represents `800.00`, the hashes differ. The second request returns `409 IDEMPOTENCY_PAYLOAD_MISMATCH`; the original transfer is unchanged.

## Transfer lifecycle and cross-service recovery

Transfers use only actionable states: `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`, and `REVERSED`. Transaction owns lifecycle state; Ledger owns posting truth. Stable transfer IDs cross the boundary. Stale processing records are reconciled against Ledger, which resolves ambiguous timeouts without distributed transactions.

## FX quotes

FX Service calls the provider abstraction when a quote is requested and persists the exact rate, source/target amounts and currencies, provider reference, issue time, and expiry time. Expiry is exactly 60 seconds after issue and is evaluated using database time. If the provider is unavailable, quote creation returns an explicit `503 FX_PROVIDER_UNAVAILABLE`; no cached rate is silently substituted.

Quote consumption is one conditional database update that succeeds only for an active, unexpired quote matching the transfer. It binds the quote to one transfer ID. A retry by that same transfer is idempotent; another transfer receives an already-used conflict. A consumed quote is not released after downstream failure, so it can never finance a second attempt.

The exact quote ID and locked rate are recorded on the Transaction and Ledger records. Once a quote exists, settlement uses the persisted locked values and does not call the provider again. The provider-down demonstration therefore covers quote acquisition failure; an already issued valid quote is intentionally independent of later provider availability.

## Payroll concurrency and resumability

Payroll persists a job and all uniquely identified items before enqueueing a deterministic BullMQ job whose ID equals the payroll job UUID. Workers may process different employers concurrently, but a worker must hold a renewable Redis lease keyed by employer before processing that employer. Acquire uses `SET NX PX`; renew and release are ownership-token-checked Redis scripts. This makes effective concurrency one for an employer without holding a database transaction open for thousands of items.

PostgreSQL item rows are the durable checkpoint. Before calling Transaction, an item moves from `PENDING` to `PROCESSING` with an attempt token. It uses a stable transfer key derived from payroll job ID and item ID. A definitive result is immediately checkpointed as `COMPLETED` or `FAILED`.

If a worker stops after 5,000 of 14,000 items, completed rows are never selected again. Processing rows are first reconciled through Transaction with the same derived key; an already completed transfer is checkpointed without paying again. Remaining items then continue. BullMQ uses five bounded exponential-backoff attempts and retains failed work for inspection; a database recovery scan re-enqueues nonterminal jobs after restarts or queue outages. The Redis lease reduces source-account contention, while Transaction/Ledger idempotency and row locks remain the final correctness controls if a lease is lost. The synchronous submission API is capped at 15,000 items; streaming ingestion is deferred.

## Money precision and transaction history

Amounts use PostgreSQL `NUMERIC(28,8)` and Prisma Decimal; FX rates use `NUMERIC(28,12)`. Currency minor-unit validation is explicit, and JavaScript floating point is not used for financial arithmetic.

Transaction Service maintains a denormalized history row per participating wallet. Queries use an HMAC-authenticated, wallet-bound cursor and tuple seek over `(walletId, occurredAt DESC, id DESC)` with a matching composite index and `limit + 1`. They select projection-local response fields and do not use deep offset pagination, aggregate Ledger rows, or recalculate balances. A bounded maintenance command repairs the projection from Transaction-owned transfer rows without querying Ledger.

## Field-level envelope encryption

Sensitive identity fields are serialized into an authenticated payload and encrypted with a random per-record AES-256-GCM Data Encryption Key. That DEK is wrapped using a versioned AES-256-GCM Key Encryption Key supplied through untracked environment configuration. The database stores ciphertext, unique nonces, authentication tags, the wrapped DEK, and non-secret key version only.

A separate keyed HMAC digest supports normalized email equality lookup without storing plaintext. Logs and traces exclude decrypted identity, passwords, tokens, raw card data, DEKs, and KEKs. Responses decrypt only the minimum fields for an authorized owner/operator. A managed KMS/HSM, audited rotation, and recovery controls are production improvements; cloud infrastructure is deliberately not required for the self-contained assessment.

## Audit hash chain

Admin Service appends allow-listed, sanitized audit events to per-entity streams. Each record includes an event ID, sequence, action, entity, actor, UTC time, sanitized metadata, previous hash, and current hash. The current SHA-256 hash covers a domain tag, previous hash, sequence, and canonical record data. Appending locks the stream head, so concurrent records receive one deterministic order.

Verification starts from a fixed genesis hash and recomputes every link. Modifying an older record changes its hash; deleting or reordering a record breaks the next sequence/previous-hash link. The verifier reports the first invalid sequence. The chain is tamper-evident, not tamper-proof against a privileged attacker who can replace all storage. Production would add immutable external copies and signed/externally anchored checkpoints.

Ledger entries remain the primary financial evidence. Audit metadata never copies sensitive plaintext.

## Observability

Services use NestJS Logger with request context, Prometheus/Grafana metrics, and OpenTelemetry traces exported through a Collector to Jaeger. Relevant logs contain UTC timestamp, request ID, trace ID when tracing is enabled, user ID when known, and transaction ID when known. Identifiers are not Prometheus labels.

The provisioned dashboard covers successful and failed Transaction request rates, HTTP p95/p99 latency, and the Ledger invariant gauge. Any invariant value above zero fires an immediate critical alert. The runtime demonstration procedure covers a complete transfer trace and the explicit FX-provider quote-acquisition failure trace; captured Docker evidence remains a release-verification item.

## Time-pressure tradeoffs

- One local PostgreSQL server reduces setup cost but is not production fault isolation; production would use independently managed databases with HA, backups, and resource controls.
- A mock FX provider proves the contract but not real provider authentication, spreads, quotas, or treasury settlement.
- The assessment uses a minimal verified-principal/authentication layer rather than building a complete identity platform.
- No frontend is built; Swagger and API examples provide the required interaction surface.
- The Admin Service is intentionally small and API-only.
- Environment-held encryption keys are a local reproducibility compromise; production requires managed KMS/HSM controls.
- PostgreSQL is sufficient for indexed history in the assessment; a new datastore is not introduced without measured need.
- Local burst/load evidence will report exact environment and limitations and will not be presented as a production capacity guarantee.

## Implementation-dependent items

The final document will add verified references to migrations, test cases, Swagger routes, dashboards, traces, and load results as they are completed. If an implemented detail differs from a decision above, the decision and its tests must be updated together before submission.
