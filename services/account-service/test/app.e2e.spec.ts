import {
  Body,
  Controller,
  INestApplication,
  Logger,
  Post,
} from '@nestjs/common';
import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { IsString } from 'class-validator';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/bootstrap.js';
import { SERVICE_METADATA } from '../src/service-metadata.js';
import { readServiceVersion } from '../src/service-version.js';
import { ReadinessService } from '../src/health/readiness.service.js';

class ValidationProbeDto {
  @IsString()
  name!: string;
}

@Controller('_test/validation')
class ValidationProbeController {
  @Post()
  validate(@Body() body: ValidationProbeDto): ValidationProbeDto {
    return body;
  }
}

describe('account-service bootstrap', () => {
  let app: INestApplication;

  beforeAll(async () => {
    delete process.env.INTERNAL_SERVICE_TOKEN;
    const testingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ValidationProbeController],
    })
      .overrideProvider(ReadinessService)
      .useValue({ check: async () => ({ database: 'up' }) })
      .compile();

    app = testingModule.createNestApplication();
    configureApplication(app, {
      ...SERVICE_METADATA,
      version: readServiceVersion(),
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(['/health/live', '/health/ready'])(
    'serves %s with the supplied request ID',
    async (path) => {
      const requestId = '4e0043d7-9306-4e15-9469-2ab8344aa5f1';
      const response = await request(app.getHttpServer())
        .get(path)
        .set('X-Request-Id', requestId)
        .expect(200);

      expect(response.headers['x-request-id']).toBe(requestId);
      expect(response.body).toEqual({
        status: 'ok',
        service: 'account-service',
        timestamp: expect.any(String),
        uptimeSeconds: expect.any(Number),
        ...(path.endsWith('/ready') ? { dependencies: { database: 'up' } } : {}),
      });
    },
  );

  it('replaces an invalid request ID', async () => {
    const response = await request(app.getHttpServer())
      .get('/health/live')
      .set('X-Request-Id', 'invalid')
      .expect(200);

    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('returns the stable error envelope', async () => {
    const requestId = '14fc8533-743f-4182-b887-24171b76e4a7';
    const response = await request(app.getHttpServer())
      .get('/missing')
      .set('X-Request-Id', requestId)
      .expect(404);

    expect(response.body).toEqual({
      code: 'NOT_FOUND',
      message: 'Resource not found.',
      requestId,
    });
  });

  it('returns validation failures through the same envelope', async () => {
    const requestId = 'a40f0a8d-5a22-429b-a012-cc12b0c10a7c';
    const response = await request(app.getHttpServer())
      .post('/_test/validation')
      .set('X-Request-Id', requestId)
      .send({ name: 42, unexpected: true })
      .expect(400);

    expect(response.body).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed.',
      requestId,
      details: {
        violations: expect.arrayContaining([
          'property unexpected should not exist',
          'name must be a string',
        ]),
      },
    });
  });

  it('exposes service metadata and health paths through Swagger', async () => {
    const response = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);

    expect(response.body.info).toMatchObject({
      title: 'NovaPay Account Service',
      version: '0.3.0',
    });
    expect(response.body.paths).toHaveProperty('/health/live');
    expect(response.body.paths).toHaveProperty('/health/ready');
    expect(response.body.paths).toHaveProperty('/wallets');
    expect(response.body.paths).toHaveProperty('/wallets/{walletId}/balance');
    expect(response.body.paths).toHaveProperty(
      '/internal/wallets/{walletId}/reconcile',
    );
  });

  it('rejects unauthenticated internal requests before database access', async () => {
    const response = await request(app.getHttpServer())
      .get('/internal/wallets/00000000-0000-4000-8000-000000000000/validation')
      .expect(401);

    expect(response.body).toMatchObject({ code: 'INTERNAL_AUTH_REQUIRED' });
  });

  it('places the request ID in structured request logs', async () => {
    const requestId = 'de8fb5ec-b16e-4c5e-abbd-a7dbf03c5c8d';
    const logSpy = jest.spyOn(Logger.prototype, 'log');

    await request(app.getHttpServer())
      .get('/health/live')
      .set('X-Request-Id', requestId)
      .expect(200);

    expect(
      logSpy.mock.calls.some(
        ([record]) =>
          typeof record === 'object' &&
          record !== null &&
          'requestId' in record &&
          record.requestId === requestId,
      ),
    ).toBe(true);

    logSpy.mockRestore();
  });
});
