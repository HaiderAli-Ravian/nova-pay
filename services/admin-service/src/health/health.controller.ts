import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { SERVICE_METADATA } from '../service-metadata.js';
import { HealthResponseDto } from './dto/health-response.dto.js';
import { ReadinessService } from './readiness.service.js';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly readiness: ReadinessService) {}

  @Get('live')
  @ApiOperation({
    summary: 'Check whether the service process is running',
  })
  @ApiOkResponse({
    description: 'The service process is running.',
    type: HealthResponseDto,
  })
  live(): HealthResponseDto {
    return this.snapshot();
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Check whether the service is ready to receive traffic',
  })
  @ApiOkResponse({
    description: 'Every required service dependency is available.',
    type: HealthResponseDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'At least one required service dependency is unavailable.',
    type: ErrorResponseDto,
  })
  async ready(): Promise<HealthResponseDto> {
    const dependencies = await this.readiness.check();
    return { ...this.snapshot(), dependencies };
  }

  private snapshot(): HealthResponseDto {
    return {
      status: 'ok',
      service: SERVICE_METADATA.name,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }
}
