import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import { RequestContextService } from '../common/request-context.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { ConsumeQuoteDto, CreateQuoteDto, QuoteResponseDto } from './dto/quote.dto.js';
import { FxProvider } from './fx-provider.js';

@Injectable()
export class QuoteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: FxProvider,
    private readonly requestContext: RequestContextService,
  ) {}

  async create(clientId: string, command: CreateQuoteDto): Promise<QuoteResponseDto> {
    if (command.sourceCurrency === command.targetCurrency) {
      throw new ConflictException({
        code: 'SAME_CURRENCY_QUOTE',
        message: 'Source and target currencies must differ.',
      });
    }
    const fresh = await this.provider.freshRate(command.sourceCurrency, command.targetCurrency);
    const sourceAmount = new Prisma.Decimal(command.sourceAmount);
    const rate = new Prisma.Decimal(fresh.rate);
    const targetAmount = sourceAmount.mul(rate).toDecimalPlaces(8);
    const quote = await this.prisma.db.$transaction(async (transaction) => {
      const [{ now }] = await transaction.$queryRaw<Array<{ now: Date }>>`
        SELECT CURRENT_TIMESTAMP AS "now"
      `;
      return transaction.fxQuote.create({
        data: {
          clientId,
          sourceCurrency: command.sourceCurrency,
          targetCurrency: command.targetCurrency,
          sourceAmount,
          targetAmount,
          rate,
          providerReference: fresh.providerReference,
          issuedAt: now,
          expiresAt: new Date(now.getTime() + 60_000),
          createdRequestId: requestId(this.requestContext.getRequestId()),
        },
      });
    });
    return toResponse(quote, quote.issuedAt);
  }

  async get(clientId: string, quoteId: string): Promise<QuoteResponseDto> {
    return this.prisma.db.$transaction(async (transaction) => {
      const [{ now }] = await transaction.$queryRaw<Array<{ now: Date }>>`
        SELECT CURRENT_TIMESTAMP AS "now"
      `;
      let quote = await transaction.fxQuote.findUnique({ where: { id: quoteId } });
      if (!quote) throw quoteNotFound();
      if (quote.clientId !== clientId) {
        throw new ForbiddenException({ code: 'QUOTE_ACCESS_DENIED', message: 'Quote access denied.' });
      }
      if (quote.status === 'ACTIVE' && quote.expiresAt <= now) {
        quote = await transaction.fxQuote.update({
          where: { id: quote.id },
          data: { status: 'EXPIRED' },
        });
      }
      return toResponse(quote, now);
    });
  }

  async consume(quoteId: string, command: ConsumeQuoteDto): Promise<QuoteResponseDto> {
    return this.prisma.db.$transaction(async (transaction) => {
      const [{ now }] = await transaction.$queryRaw<Array<{ now: Date }>>`
        SELECT CURRENT_TIMESTAMP AS "now"
      `;
      const quote = await transaction.fxQuote.findUnique({ where: { id: quoteId } });
      if (!quote) throw quoteNotFound();
      if (quote.clientId !== command.clientId) {
        throw new ForbiddenException({ code: 'QUOTE_ACCESS_DENIED', message: 'Quote access denied.' });
      }
      if (
        quote.sourceCurrency !== command.sourceCurrency ||
        quote.targetCurrency !== command.targetCurrency ||
        !quote.sourceAmount.equals(command.sourceAmount)
      ) {
        throw new ConflictException({
          code: 'QUOTE_DETAILS_MISMATCH',
          message: 'The quote does not match the transfer details.',
        });
      }
      if (quote.status === 'CONSUMED') {
        if (quote.consumedByTransferId === command.transferId) return toResponse(quote, now);
        throw new ConflictException({
          code: 'QUOTE_ALREADY_USED',
          message: 'The quote was already consumed by another transfer.',
        });
      }
      if (quote.status === 'EXPIRED' || quote.expiresAt <= now) {
        if (quote.status === 'ACTIVE') {
          await transaction.fxQuote.update({ where: { id: quote.id }, data: { status: 'EXPIRED' } });
        }
        throw new ConflictException({ code: 'QUOTE_EXPIRED', message: 'The FX quote has expired.' });
      }
      const claimed = await transaction.fxQuote.updateMany({
        where: {
          id: quote.id,
          status: 'ACTIVE',
          expiresAt: { gt: now },
          consumedByTransferId: null,
        },
        data: {
          status: 'CONSUMED',
          consumedAt: now,
          consumedByTransferId: command.transferId,
        },
      });
      if (claimed.count !== 1) {
        const winner = await transaction.fxQuote.findUniqueOrThrow({ where: { id: quote.id } });
        if (winner.consumedByTransferId === command.transferId) return toResponse(winner, now);
        throw new ConflictException({
          code: 'QUOTE_ALREADY_USED',
          message: 'The quote was already consumed by another transfer.',
        });
      }
      return toResponse(
        await transaction.fxQuote.findUniqueOrThrow({ where: { id: quote.id } }),
        now,
      );
    });
  }
}

function requestId(value: string): string {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : randomUUID();
}

function quoteNotFound(): NotFoundException {
  return new NotFoundException({ code: 'QUOTE_NOT_FOUND', message: 'FX quote not found.' });
}

function toResponse(quote: Prisma.FxQuoteModel, now: Date): QuoteResponseDto {
  const valid = quote.status === 'ACTIVE' && quote.expiresAt > now;
  return {
    quoteId: quote.id,
    sourceCurrency: quote.sourceCurrency,
    targetCurrency: quote.targetCurrency,
    sourceAmount: quote.sourceAmount.toFixed(8),
    targetAmount: quote.targetAmount.toFixed(8),
    rate: quote.rate.toFixed(12),
    status: quote.status,
    issuedAt: quote.issuedAt.toISOString(),
    expiresAt: quote.expiresAt.toISOString(),
    valid,
    remainingSeconds: valid ? Math.max(0, Math.ceil((quote.expiresAt.getTime() - now.getTime()) / 1000)) : 0,
  };
}
