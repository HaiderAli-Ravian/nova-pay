import {
  ConsoleLogger,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export interface ApplicationMetadata {
  name: string;
  title: string;
  description: string;
  version: string;
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  });
}

export function configureApplication(
  app: INestApplication,
  metadata: ApplicationMetadata,
): void {
  app.useLogger(
    new ConsoleLogger(metadata.name, {
      json: true,
      timestamp: true,
    }),
  );
  app.useGlobalPipes(createValidationPipe());
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle(metadata.title)
    .setDescription(metadata.description)
    .setVersion(metadata.version)
    .addBearerAuth()
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);

  SwaggerModule.setup('docs', app, swaggerDocument, {
    jsonDocumentUrl: 'docs-json',
  });
}

