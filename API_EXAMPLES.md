# NovaPay Public API Examples

All requests use the Nginx gateway at `http://localhost:8080`. UUIDs, timestamps,
cursors, and hashes below are illustrative. Swagger remains the executable
contract for validation constraints and all documented response schemas.

User routes require `Authorization: Bearer <principal>`. Admin routes require an
`operator:<id>` principal. Mutation routes that declare `Idempotency-Key` accept
1–128 visible ASCII characters.

## Operational surfaces

Gateway liveness:

```bash
curl http://localhost:8080/health/live
```

```json
{"status":"ok","service":"api-gateway"}
```

Each service exposes liveness and dependency-aware readiness through the
gateway. The readiness example below applies to every service; liveness uses the
same shape without the `dependencies` object.

```bash
curl http://localhost:8080/services/account/health/ready
```

```json
{
  "status": "ok",
  "service": "account-service",
  "timestamp": "2026-08-31T10:00:00.000Z",
  "uptimeSeconds": 42,
  "dependencies": {"database": "up"}
}
```

| Service | Liveness | Readiness | Swagger UI |
|---|---|---|---|
| Account | `/services/account/health/live` | `/services/account/health/ready` | `/services/account/docs` |
| Transaction | `/services/transaction/health/live` | `/services/transaction/health/ready` | `/services/transaction/docs` |
| Ledger | `/services/ledger/health/live` | `/services/ledger/health/ready` | `/services/ledger/docs` |
| FX | `/services/fx/health/live` | `/services/fx/health/ready` | `/services/fx/docs` |
| Payroll | `/services/payroll/health/live` | `/services/payroll/health/ready` | `/services/payroll/docs` |
| Admin | `/services/admin/health/live` | `/services/admin/health/ready` | `/services/admin/docs` |

## Account and wallets

### `POST /wallets`

```bash
curl -X POST http://localhost:8080/wallets \
  -H 'Authorization: Bearer alice' \
  -H 'Idempotency-Key: wallet-usd-001' \
  -H 'Content-Type: application/json' \
  -d '{"currency":"USD","label":"Everyday spending"}'
```

```json
{
  "id": "34c25a45-3293-41bb-9f56-6ef234f53394",
  "currency": "USD",
  "label": "Everyday spending",
  "status": "ACTIVE",
  "ledgerAccountId": "4f000f6f-ac30-491b-8c44-592c12eb98f1",
  "balance": {"available":"0.00000000","currency":"USD","version":"0"}
}
```

### `GET /wallets`

```bash
curl http://localhost:8080/wallets \
  -H 'Authorization: Bearer alice'
```

```json
[
  {
    "id": "34c25a45-3293-41bb-9f56-6ef234f53394",
    "currency": "USD",
    "label": "Everyday spending",
    "status": "ACTIVE",
    "ledgerAccountId": "4f000f6f-ac30-491b-8c44-592c12eb98f1",
    "balance": {"available":"900.00000000","currency":"USD","version":"2"}
  }
]
```

### `GET /wallets/:walletId/balance`

```bash
curl http://localhost:8080/wallets/34c25a45-3293-41bb-9f56-6ef234f53394/balance \
  -H 'Authorization: Bearer alice'
```

```json
{"available":"900.00000000","currency":"USD","version":"2"}
```

### `PUT /users/me/identity`

```bash
curl -X PUT http://localhost:8080/users/me/identity \
  -H 'Authorization: Bearer alice' \
  -H 'Content-Type: application/json' \
  -d '{"legalName":"Alice Example","email":"alice@example.com","phone":"+15555550123","postalAddress":"100 Main Street, Example City","governmentId":"TAX-123456"}'
```

```json
{
  "userId": "a45bf6fb-cc48-45df-a753-e18209a6e70e",
  "externalRef": "alice",
  "legalName": "Alice Example",
  "email": "alice@example.com",
  "phone": "+15555550123",
  "postalAddress": "100 Main Street, Example City",
  "governmentId": "TAX-123456"
}
```

### `GET /users/me/identity`

```bash
curl http://localhost:8080/users/me/identity \
  -H 'Authorization: Bearer alice'
```

```json
{
  "userId": "a45bf6fb-cc48-45df-a753-e18209a6e70e",
  "externalRef": "alice",
  "legalName": "Alice Example",
  "email": "alice@example.com",
  "phone": "+15555550123",
  "postalAddress": "100 Main Street, Example City",
  "governmentId": "TAX-123456"
}
```

## Transfers and history

### `POST /transfers`

```bash
curl -X POST http://localhost:8080/transfers \
  -H 'Authorization: Bearer alice' \
  -H 'Idempotency-Key: transfer-001' \
  -H 'Content-Type: application/json' \
  -d '{"senderWalletId":"34c25a45-3293-41bb-9f56-6ef234f53394","recipientWalletId":"d72ba34e-2391-4916-b039-c856ace82b9e","amount":"100.00000000","currency":"USD"}'
```

```json
{
  "transferId": "9a459c61-392e-453f-a08d-3d684e6be503",
  "status": "COMPLETED",
  "sourceAmount": "100.00000000",
  "sourceCurrency": "USD",
  "targetAmount": "100.00000000",
  "targetCurrency": "USD",
  "ledgerTransactionId": "8b489805-7c56-4d51-9358-bbcf78204e97",
  "completedAt": "2026-08-31T10:01:00.000Z"
}
```

### `GET /transfers/:transferId`

```bash
curl http://localhost:8080/transfers/9a459c61-392e-453f-a08d-3d684e6be503 \
  -H 'Authorization: Bearer alice'
```

```json
{
  "transferId": "9a459c61-392e-453f-a08d-3d684e6be503",
  "status": "COMPLETED",
  "sourceAmount": "100.00000000",
  "sourceCurrency": "USD",
  "targetAmount": "100.00000000",
  "targetCurrency": "USD",
  "ledgerTransactionId": "8b489805-7c56-4d51-9358-bbcf78204e97",
  "completedAt": "2026-08-31T10:01:00.000Z"
}
```

### `GET /wallets/:walletId/transactions`

```bash
curl 'http://localhost:8080/wallets/34c25a45-3293-41bb-9f56-6ef234f53394/transactions?limit=50' \
  -H 'Authorization: Bearer alice'
```

```json
{
  "items": [
    {
      "transferId": "9a459c61-392e-453f-a08d-3d684e6be503",
      "direction": "OUTGOING",
      "amount": "100.00000000",
      "currency": "USD",
      "status": "COMPLETED",
      "occurredAt": "2026-08-31T10:01:00.000Z"
    }
  ],
  "nextCursor": null
}
```

## FX quotes and international transfers

### `POST /fx/quote`

```bash
curl -X POST http://localhost:8080/fx/quote \
  -H 'Authorization: Bearer alice' \
  -H 'Content-Type: application/json' \
  -d '{"sourceCurrency":"USD","targetCurrency":"EUR","sourceAmount":"100.00000000"}'
```

```json
{
  "quoteId": "e7ac7ee1-3834-4a09-8ac5-8524384314d3",
  "sourceCurrency": "USD",
  "targetCurrency": "EUR",
  "sourceAmount": "100.00000000",
  "targetAmount": "92.00000000",
  "rate": "0.920000000000",
  "status": "ACTIVE",
  "issuedAt": "2026-08-31T10:02:00.000Z",
  "expiresAt": "2026-08-31T10:03:00.000Z",
  "valid": true,
  "remainingSeconds": 60
}
```

### `GET /fx/quote/:quoteId`

```bash
curl http://localhost:8080/fx/quote/e7ac7ee1-3834-4a09-8ac5-8524384314d3 \
  -H 'Authorization: Bearer alice'
```

```json
{
  "quoteId": "e7ac7ee1-3834-4a09-8ac5-8524384314d3",
  "sourceCurrency": "USD",
  "targetCurrency": "EUR",
  "sourceAmount": "100.00000000",
  "targetAmount": "92.00000000",
  "rate": "0.920000000000",
  "status": "ACTIVE",
  "issuedAt": "2026-08-31T10:02:00.000Z",
  "expiresAt": "2026-08-31T10:03:00.000Z",
  "valid": true,
  "remainingSeconds": 41
}
```

### `POST /transfers/international`

```bash
curl -X POST http://localhost:8080/transfers/international \
  -H 'Authorization: Bearer alice' \
  -H 'Idempotency-Key: international-001' \
  -H 'Content-Type: application/json' \
  -d '{"senderWalletId":"34c25a45-3293-41bb-9f56-6ef234f53394","recipientWalletId":"27eed329-3aaf-4713-9ed7-a607781766b5","sourceAmount":"100.00000000","sourceCurrency":"USD","targetCurrency":"EUR","quoteId":"e7ac7ee1-3834-4a09-8ac5-8524384314d3"}'
```

```json
{
  "transferId": "4bed2596-332c-4f0c-aec1-35ece0eb34ef",
  "status": "COMPLETED",
  "sourceAmount": "100.00000000",
  "sourceCurrency": "USD",
  "targetAmount": "92.00000000",
  "targetCurrency": "EUR",
  "quoteId": "e7ac7ee1-3834-4a09-8ac5-8524384314d3",
  "lockedRate": "0.920000000000",
  "ledgerTransactionId": "90f3163a-88d3-458d-a34c-ea14aa2eb417",
  "completedAt": "2026-08-31T10:02:20.000Z"
}
```

## Payroll

### `POST /payroll/jobs`

```bash
curl -X POST http://localhost:8080/payroll/jobs \
  -H 'Authorization: Bearer employer-a' \
  -H 'Idempotency-Key: payroll-2026-08-001' \
  -H 'Content-Type: application/json' \
  -d '{"sourceWalletId":"c5511d5e-7bea-4215-a86a-dac725114b25","currency":"USD","items":[{"externalItemId":"employee-001-2026-08","recipientWalletId":"d72ba34e-2391-4916-b039-c856ace82b9e","amount":"2500.00000000"}]}'
```

```json
{
  "jobId": "5b99d62c-dd17-48a5-b4de-a4d2a5af9b6c",
  "status": "QUEUED",
  "totalItems": 1,
  "pendingItems": 1,
  "processingItems": 0,
  "completedItems": 0,
  "failedItems": 0,
  "updatedAt": "2026-08-31T10:04:00.000Z",
  "statusUrl": "/payroll/jobs/5b99d62c-dd17-48a5-b4de-a4d2a5af9b6c"
}
```

### `GET /payroll/jobs/:jobId`

```bash
curl http://localhost:8080/payroll/jobs/5b99d62c-dd17-48a5-b4de-a4d2a5af9b6c \
  -H 'Authorization: Bearer employer-a'
```

```json
{
  "jobId": "5b99d62c-dd17-48a5-b4de-a4d2a5af9b6c",
  "status": "COMPLETED",
  "totalItems": 1,
  "pendingItems": 0,
  "processingItems": 0,
  "completedItems": 1,
  "failedItems": 0,
  "updatedAt": "2026-08-31T10:04:03.000Z",
  "failures": [],
  "queueFailureCount": 0,
  "lastQueueErrorCode": null
}
```

## Admin audit

### `POST /admin/audit/verify`

```bash
curl -X POST http://localhost:8080/admin/audit/verify \
  -H 'Authorization: Bearer operator:reviewer' \
  -H 'Idempotency-Key: verify-transfer-stream-001' \
  -H 'Content-Type: application/json' \
  -d '{"streamKey":"wallet:34c25a45-3293-41bb-9f56-6ef234f53394"}'
```

```json
{
  "streamKey": "wallet:34c25a45-3293-41bb-9f56-6ef234f53394",
  "valid": true,
  "recordsChecked": 1,
  "firstInvalidSequence": null
}
```

### `GET /admin/audit/streams/:streamKey/records`

```bash
curl http://localhost:8080/admin/audit/streams/wallet:34c25a45-3293-41bb-9f56-6ef234f53394/records \
  -H 'Authorization: Bearer operator:reviewer'
```

```json
[
  {
    "eventId": "759b1cec-b77b-4c77-a748-29dd635af28d",
    "streamKey": "wallet:34c25a45-3293-41bb-9f56-6ef234f53394",
    "sequence": "1",
    "action": "wallet.activated",
    "entityType": "wallet",
    "entityId": "34c25a45-3293-41bb-9f56-6ef234f53394",
    "actorId": "alice",
    "occurredAt": "2026-08-31T10:00:00.000Z",
    "metadata": {"currency":"USD"},
    "previousHash": "0000000000000000000000000000000000000000000000000000000000000000",
    "currentHash": "f4b8e8132cc421484fc65f01c5a06c88cb78e6b9597cb62e442229150043f732"
  }
]
```

## Error envelope and material codes

Non-transfer failures use a stable envelope:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Request validation failed.",
  "requestId": "4e0043d7-9306-4e15-9469-2ab8344aa5f1",
  "details": {"violations":["currency must match /^[A-Z]{3}$/"]}
}
```

Transfer processing failures may instead return a `TransferResponseDto` with
`status: "FAILED"` and a safe `failure` object. Repeating the same idempotency
key and payload returns the stored response.

| HTTP | Code | Meaning |
|---:|---|---|
| 400 | `VALIDATION_ERROR` | Body, parameter, or query validation failed. |
| 400/409 | `INVALID_IDEMPOTENCY_KEY` | The idempotency key is absent or malformed; wallet creation preserves its established conflict response. |
| 400 | `INVALID_CURSOR` / `INVALID_PAGE_LIMIT` | The history cursor or page size is invalid. |
| 400 | `SAME_WALLET_TRANSFER` / `SAME_CURRENCY_TRANSFER` | Transfer endpoints received a prohibited wallet/currency combination. |
| 401 | `INVALID_PRINCIPAL` | A valid user or operator bearer principal is required. |
| 403 | `WALLET_ACCESS_DENIED` / `TRANSFER_ACCESS_DENIED` / `QUOTE_ACCESS_DENIED` / `PAYROLL_ACCESS_DENIED` | The principal does not own the requested resource. |
| 404 | `WALLET_NOT_FOUND` / `USER_IDENTITY_NOT_FOUND` / `TRANSFER_NOT_FOUND` / `QUOTE_NOT_FOUND` / `PAYROLL_JOB_NOT_FOUND` / `AUDIT_STREAM_NOT_FOUND` | The requested resource does not exist. |
| 409 | `IDEMPOTENCY_PAYLOAD_MISMATCH` / `IDEMPOTENCY_KEY_REUSED` | A key was reused with a different canonical request. |
| 409 | `IDEMPOTENCY_KEY_EXPIRED` | The 24-hour response window elapsed; the safety tombstone blocks replay. |
| 409 | `WALLET_ALREADY_EXISTS` / `WALLET_UNAVAILABLE` / `CURRENCY_MISMATCH` | Wallet state or currency prevents the operation. |
| 409 | `EMAIL_ALREADY_EXISTS` | The normalized email is already owned by another identity. |
| 409 | `SAME_CURRENCY_QUOTE` / `QUOTE_DETAILS_MISMATCH` / `QUOTE_ALREADY_USED` / `QUOTE_EXPIRED` | The FX quote cannot be issued or consumed. |
| 413 | `PAYROLL_TOO_LARGE` | The payroll exceeds 15,000 items or the configured request limit. |
| 422 | `INSUFFICIENT_FUNDS` | The authoritative Ledger balance cannot cover the debit. |
| 422 | `UNSUPPORTED_CURRENCY_PAIR` | The deterministic provider has no configured rate for the pair. |
| 503 | `ACCOUNT_UNAVAILABLE` / `LEDGER_UNAVAILABLE` / `AUDIT_UNAVAILABLE` / `QUEUE_UNAVAILABLE` | A required dependency is unavailable. |
| 503 | `FX_PROVIDER_UNAVAILABLE` | Fresh quote acquisition failed; no cached substitute was used. |
| 503 | `SERVICE_NOT_READY` | A readiness dependency is down. |

Responses never include stack traces, SQL, credentials, encryption material, or
decrypted identity fields belonging to another principal.
