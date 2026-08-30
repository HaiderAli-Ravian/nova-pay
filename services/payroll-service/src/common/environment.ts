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

export function requireEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name} is required.`);
  return value;
}
