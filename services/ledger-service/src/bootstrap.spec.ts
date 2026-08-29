import { ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { IsString } from 'class-validator';
import { createValidationPipe } from './bootstrap.js';

class ValidationFixtureDto {
  @IsString()
  name!: string;
}

const bodyMetadata: ArgumentMetadata = {
  type: 'body',
  metatype: ValidationFixtureDto,
};

describe('createValidationPipe', () => {
  it('transforms valid input into its DTO', async () => {
    const result = await createValidationPipe().transform(
      { name: 'NovaPay' },
      bodyMetadata,
    );

    expect(result).toBeInstanceOf(ValidationFixtureDto);
    expect(result).toEqual({ name: 'NovaPay' });
  });

  it('rejects properties outside the DTO allow-list', async () => {
    await expect(
      createValidationPipe().transform(
        { name: 'NovaPay', unexpected: true },
        bodyMetadata,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects invalid DTO values', async () => {
    await expect(
      createValidationPipe().transform({ name: 42 }, bodyMetadata),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
