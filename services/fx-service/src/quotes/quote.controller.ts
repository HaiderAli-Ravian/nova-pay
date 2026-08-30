import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiSecurity,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { PrincipalService } from '../auth/principal.service.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { InternalServiceGuard } from '../common/internal-service.guard.js';
import { ConsumeQuoteDto, CreateQuoteDto, QuoteResponseDto } from './dto/quote.dto.js';
import { QuoteService } from './quote.service.js';

@ApiTags('fx-quotes')
@ApiBearerAuth()
@Controller('fx/quote')
export class QuoteController {
  constructor(private readonly quotes: QuoteService, private readonly principal: PrincipalService) {}

  @Post()
  @ApiCreatedResponse({ type: QuoteResponseDto })
  @ApiConflictResponse({ description: 'The currency pair is invalid.' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiUnprocessableEntityResponse({ type: ErrorResponseDto })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto })
  create(@Req() request: Request, @Body() body: CreateQuoteDto) {
    return this.quotes.create(this.principal.fromRequest(request), body);
  }

  @Get(':quoteId')
  @ApiOkResponse({ type: QuoteResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  get(@Req() request: Request, @Param('quoteId', new ParseUUIDPipe()) quoteId: string) {
    return this.quotes.get(this.principal.fromRequest(request), quoteId);
  }
}

@ApiTags('internal-fx')
@ApiSecurity('internal-service')
@UseGuards(InternalServiceGuard)
@Controller('internal/fx/quotes')
export class InternalQuoteController {
  constructor(private readonly quotes: QuoteService) {}

  @Post(':quoteId/consume')
  @ApiOkResponse({ type: QuoteResponseDto })
  consume(
    @Param('quoteId', new ParseUUIDPipe()) quoteId: string,
    @Body() body: ConsumeQuoteDto,
  ) {
    return this.quotes.consume(quoteId, body);
  }
}
