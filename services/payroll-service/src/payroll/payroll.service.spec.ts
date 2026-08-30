import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { canonicalPayrollHash, normalizeCommand } from './payroll.service.js';
import type { CreatePayrollJobDto } from './dto/create-payroll-job.dto.js';

const sourceWalletId = 'c5511d5e-7bea-4215-a86a-dac725114b25';
const recipientA = 'd72ba34e-2391-4916-b039-c856ace82b9e';
const recipientB = 'cd69734e-0e7a-4814-a232-707ed8e77ed1';

function command(): CreatePayrollJobDto {
  return {
    sourceWalletId,
    currency: 'USD',
    items: [
      { externalItemId: 'employee-b', recipientWalletId: recipientB, amount: '2.0' },
      { externalItemId: 'employee-a', recipientWalletId: recipientA, amount: '1.00' },
    ],
  };
}

describe('payroll request canonicalization', () => {
  it('sorts items deterministically and normalizes decimal values for hashing', () => {
    const first = normalizeCommand(command());
    const second = normalizeCommand({ ...command(), items: [...command().items].reverse() });
    expect(first.items.map((item) => item.externalItemId)).toEqual(['employee-a', 'employee-b']);
    expect(canonicalPayrollHash(first)).toBe(canonicalPayrollHash(second));
  });

  it('rejects duplicate external item identifiers', () => {
    const input = command();
    input.items[1]!.externalItemId = input.items[0]!.externalItemId;
    expect(() => normalizeCommand(input)).toThrow(BadRequestException);
  });

  it('enforces the documented 15,000-item limit', () => {
    const item = command().items[0]!;
    const input = command();
    input.items = Array.from({ length: 15_001 }, (_, index) => ({
      ...item,
      externalItemId: `employee-${index}`,
    }));
    expect(() => normalizeCommand(input)).toThrow(PayloadTooLargeException);
  });
});
