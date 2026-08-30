import { redactSensitive } from './redaction.js';

describe('redactSensitive', () => {
  it('removes sensitive values recursively while retaining safe context', () => {
    const canary = 'never-log-this-canary';
    const output = JSON.stringify(redactSensitive({
      event: 'identity.updated',
      authorization: canary,
      nested: { email: canary, password: canary, requestId: 'safe-id' },
    }));
    expect(output).not.toContain(canary);
    expect(output).toContain('safe-id');
  });
});
