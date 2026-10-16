import { validateEnv } from './env.validation';

const VALID_PRODUCTION_ENV = {
  NODE_ENV: 'production',
  JWT_SECRET: '0123456789abcdef0123456789abcdef',
  DATABASE_URL: 'postgresql://cardhub:cardhub@localhost:5432/cardhub',
};

describe('validateEnv', () => {
  it('rejects production startup when required config is missing', () => {
    expect(() => validateEnv({ NODE_ENV: 'production' })).toThrow(
      [
        'Invalid Cardhub API environment configuration:',
        '- JWT_SECRET is required when NODE_ENV=production',
        '- DATABASE_URL is required when NODE_ENV=production',
      ].join('\n'),
    );
  });

  it.each([
    ['dev-insecure-secret'],
    ['change-me-in-production'],
    ['change-me-generate-with-openssl-rand-hex-32'],
  ])('rejects production startup when JWT_SECRET uses placeholder %s', (jwtSecret) => {
    expect(() =>
      validateEnv({
        ...VALID_PRODUCTION_ENV,
        JWT_SECRET: jwtSecret,
      }),
    ).toThrow(`JWT_SECRET must not use the placeholder value "${jwtSecret}"`);
  });

  it('rejects production startup when JWT_SECRET is shorter than 32 characters', () => {
    expect(() =>
      validateEnv({
        ...VALID_PRODUCTION_ENV,
        JWT_SECRET: 'short-production-secret',
      }),
    ).toThrow('JWT_SECRET must be at least 32 characters when NODE_ENV=production');
  });

  it('accepts production startup when JWT_SECRET and DATABASE_URL are valid', () => {
    expect(validateEnv(VALID_PRODUCTION_ENV)).toBe(VALID_PRODUCTION_ENV);
  });

  it.each(['development', 'test', undefined])(
    'keeps existing non-production defaults working when NODE_ENV is %s',
    (nodeEnv) => {
      const config = {
        NODE_ENV: nodeEnv,
        JWT_SECRET: 'dev-insecure-secret',
      };

      expect(validateEnv(config)).toBe(config);
    },
  );
});
