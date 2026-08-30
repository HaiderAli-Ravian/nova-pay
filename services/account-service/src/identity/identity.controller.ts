import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { PrincipalService } from '../auth/principal.service.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { InternalServiceGuard } from '../common/internal-service.guard.js';
import {
  IdentityLookupDto,
  UpdateUserIdentityDto,
  UserIdentityResponseDto,
} from './dto/user-identity.dto.js';
import { IdentityService } from './identity.service.js';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users/me/identity')
export class IdentityController {
  constructor(
    private readonly identities: IdentityService,
    private readonly principal: PrincipalService,
  ) {}

  @Put()
  @ApiOkResponse({ type: UserIdentityResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiInternalServerErrorResponse({ type: ErrorResponseDto })
  update(@Req() request: Request, @Body() body: UpdateUserIdentityDto) {
    return this.identities.update(this.principal.fromRequest(request), body);
  }

  @Get()
  @ApiOkResponse({ type: UserIdentityResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  @ApiInternalServerErrorResponse({ type: ErrorResponseDto })
  get(@Req() request: Request) {
    return this.identities.get(this.principal.fromRequest(request));
  }
}

@ApiTags('internal-users')
@ApiSecurity('internal-service')
@UseGuards(InternalServiceGuard)
@Controller('internal/users')
export class InternalIdentityController {
  constructor(private readonly identities: IdentityService) {}

  @Post('lookup-by-email')
  @ApiOkResponse()
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  lookup(@Body() body: IdentityLookupDto) {
    return this.identities.lookup(body.email);
  }
}
