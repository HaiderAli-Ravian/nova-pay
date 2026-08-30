export type NodeEnvironment = 'development' | 'test' | 'production';

export interface ServiceEnvironment {
  nodeEnv: NodeEnvironment;
  port: number;
}

const allowedNodeEnvironments = new Set<NodeEnvironment>([
  'development',
  'test',
  'production',
]);

export function loadEnvironment(defaultPort: number): ServiceEnvironment {
  const nodeEnv = process.env.NODE_ENV ?? 'development';

  if (!allowedNodeEnvironments.has(nodeEnv as NodeEnvironment)) {
    throw new Error(
      'NODE_ENV must be one of development, test, or production.',
    );
  }

  const rawPort = process.env.PORT ?? String(defaultPort);
  const port = Number(rawPort);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  return Object.freeze({
    nodeEnv: nodeEnv as NodeEnvironment,
    port,
  });
}

export function requireUrlEnvironmentVariable(
  name: string,
  allowedProtocols: readonly string[],
): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }

  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new Error(
      `${name} must use one of: ${allowedProtocols.join(', ')}.`,
    );
  }

  return value;
}

export function requireSecretEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value || value.length < 24) {
    throw new Error(`${name} must contain at least 24 characters.`);
  }
  return value;
}

export function requireBase64KeyEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== 32 || decoded.toString('base64') !== value) {
    throw new Error(`${name} must be a canonical base64-encoded 32-byte key.`);
  }
  return value;
}

export function readPositiveIntegerEnvironmentVariable(
  name: string,
  fallback: number,
): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 86_400_000) {
    throw new Error(`${name} must be a positive integer no greater than 86400000.`);
  }
  return value;
}
