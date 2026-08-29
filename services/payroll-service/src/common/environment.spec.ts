import { loadEnvironment } from './environment.js';

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
