import { redactSensitive } from './redaction.js';

describe('redactSensitive', () => {
  it('removes nested secrets and restricted identity canaries', () => {
    const canary = 'never-log-this-canary';
    const output = JSON.stringify(redactSensitive({
      event: 'audit.appended',
      token: canary,
      nested: { governmentId: canary, requestId: 'safe-id' },
    }));
    expect(output).not.toContain(canary);
    expect(output).toContain('safe-id');
  });
});
