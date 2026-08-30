export class UpstreamHttpError extends Error {
  constructor(
    readonly service: 'account' | 'transaction',
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'UpstreamHttpError';
  }
}

export class UpstreamUnavailableError extends Error {
  constructor(readonly service: 'account' | 'transaction') {
    super(`${service} service is unavailable.`);
    this.name = 'UpstreamUnavailableError';
  }
}
