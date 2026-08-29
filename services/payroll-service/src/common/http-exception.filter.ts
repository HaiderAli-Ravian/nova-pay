import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { RequestContextService } from './request-context.service.js';

interface ErrorDescriptor {
  code: string;
  message: string;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly requestContext: RequestContextService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const descriptor = describeStatus(status);
    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const customResponse = asRecord(exceptionResponse);

    const hasCustomCode = typeof customResponse?.code === 'string';
    const code = hasCustomCode ? (customResponse.code as string) : descriptor.code;
    const message =
      hasCustomCode && typeof customResponse?.message === 'string'
        ? customResponse.message
        : descriptor.message;
    const validationMessages = Array.isArray(customResponse?.message)
      ? customResponse.message.filter(
          (item): item is string => typeof item === 'string',
        )
      : [];

    response.status(status).json({
      code,
      message,
      requestId: this.requestContext.getRequestId(),
      ...(validationMessages.length > 0
        ? { details: { violations: validationMessages } }
        : {}),
    });
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function describeStatus(status: number): ErrorDescriptor {
  const descriptors: Record<number, ErrorDescriptor> = {
    [HttpStatus.BAD_REQUEST]: {
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed.',
    },
    [HttpStatus.UNAUTHORIZED]: {
      code: 'UNAUTHORIZED',
      message: 'Authentication is required.',
    },
    [HttpStatus.FORBIDDEN]: {
      code: 'FORBIDDEN',
      message: 'The requested operation is not allowed.',
    },
    [HttpStatus.NOT_FOUND]: {
      code: 'NOT_FOUND',
      message: 'Resource not found.',
    },
    [HttpStatus.METHOD_NOT_ALLOWED]: {
      code: 'METHOD_NOT_ALLOWED',
      message: 'Method not allowed.',
    },
    [HttpStatus.CONFLICT]: {
      code: 'CONFLICT',
      message: 'The request conflicts with current state.',
    },
    [HttpStatus.PAYLOAD_TOO_LARGE]: {
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Request payload is too large.',
    },
    [HttpStatus.UNPROCESSABLE_ENTITY]: {
      code: 'UNPROCESSABLE_ENTITY',
      message: 'The request could not be processed.',
    },
    [HttpStatus.TOO_MANY_REQUESTS]: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many requests.',
    },
    [HttpStatus.SERVICE_UNAVAILABLE]: {
      code: 'SERVICE_UNAVAILABLE',
      message: 'Service is temporarily unavailable.',
    },
    [HttpStatus.INTERNAL_SERVER_ERROR]: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred.',
    },
  };

  return (
    descriptors[status] ?? {
      code: `HTTP_${status}`,
      message: 'Request failed.',
    }
  );
}
