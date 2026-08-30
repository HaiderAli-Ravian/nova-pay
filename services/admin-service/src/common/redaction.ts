const SENSITIVE_KEY = /(authorization|cookie|token|password|secret|card|kek|dek|plaintext|legal.?name|email|phone|address|government|tax|identity)/i;

export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactSensitive(child),
    ]),
  );
}
