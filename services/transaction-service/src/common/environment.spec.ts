import {
  loadEnvironment,
  requireBase64KeyEnvironmentVariable,
} from './environment.js';

describe('loadEnvironment', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalPort = process.env.PORT;

  afterEach(() => {
    restoreEnvironmentValue('NODE_ENV', originalNodeEnv);
    restoreEnvironmentValue('PORT', originalPort);
  });

  it('uses the service default when optional values are absent', () => {
    delete process.env.NODE_ENV;
    delete process.env.PORT;

    expect(loadEnvironment(3000)).toEqual({
      nodeEnv: 'development',
      port: 3000,
    });
  });

  it('accepts a valid explicit environment', () => {
    process.env.NODE_ENV = 'test';
    process.env.PORT = '4100';

    expect(loadEnvironment(3000)).toEqual({
      nodeEnv: 'test',
      port: 4100,
    });
  });

  it.each(['0', '65536', 'not-a-port', '3000.5'])(
    'rejects invalid PORT value %s',
    (port) => {
      process.env.PORT = port;

      expect(() => loadEnvironment(3000)).toThrow(
        'PORT must be an integer between 1 and 65535.',
      );
    },
  );

  it('rejects an unsupported NODE_ENV', () => {
    process.env.NODE_ENV = 'staging';

    expect(() => loadEnvironment(3000)).toThrow(
      'NODE_ENV must be one of development, test, or production.',
    );
  });
});

describe('requireBase64KeyEnvironmentVariable', () => {
  const originalValue = process.env.HISTORY_CURSOR_HMAC_KEY;

  afterEach(() => {
    if (originalValue === undefined) delete process.env.HISTORY_CURSOR_HMAC_KEY;
    else process.env.HISTORY_CURSOR_HMAC_KEY = originalValue;
  });

  it('accepts exactly 32 canonical base64-encoded bytes', () => {
    const value = Buffer.alloc(32, 7).toString('base64');
    process.env.HISTORY_CURSOR_HMAC_KEY = value;
    expect(requireBase64KeyEnvironmentVariable('HISTORY_CURSOR_HMAC_KEY')).toBe(value);
  });

  it.each(['short', Buffer.alloc(31).toString('base64'), 'not-base64!'])(
    'rejects invalid key %s',
    (value) => {
      process.env.HISTORY_CURSOR_HMAC_KEY = value;
      expect(() => requireBase64KeyEnvironmentVariable('HISTORY_CURSOR_HMAC_KEY')).toThrow(
        'HISTORY_CURSOR_HMAC_KEY must be a canonical base64-encoded 32-byte key.',
      );
    },
  );
});

function restoreEnvironmentValue(
  key: 'NODE_ENV' | 'PORT',
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
