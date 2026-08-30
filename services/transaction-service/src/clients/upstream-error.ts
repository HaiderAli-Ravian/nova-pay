export class UpstreamHttpError extends Error {
  constructor(
    readonly service: 'account' | 'ledger',
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'UpstreamHttpError';
  }
}

export class UpstreamUnavailableError extends Error {
  constructor(readonly service: 'account' | 'ledger') {
    super(`${service} service is unavailable.`);
    this.name = 'UpstreamUnavailableError';
  }
}
