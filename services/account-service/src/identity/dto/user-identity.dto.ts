import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

export class UpdateUserIdentityDto {
  @ApiProperty({ example: 'Alice Example' })
  @IsString()
  @Length(1, 160)
  legalName!: string;

  @ApiProperty({ example: 'alice@example.com' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiPropertyOptional({ example: '+15555550123' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional({ example: '100 Main Street, Example City' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  postalAddress?: string;

  @ApiPropertyOptional({ example: 'TAX-123456' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  governmentId?: string;
}

export class UserIdentityResponseDto {
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty() externalRef!: string;
  @ApiPropertyOptional({ nullable: true }) legalName!: string | null;
  @ApiPropertyOptional({ nullable: true }) email!: string | null;
  @ApiPropertyOptional({ nullable: true }) phone!: string | null;
  @ApiPropertyOptional({ nullable: true }) postalAddress!: string | null;
  @ApiPropertyOptional({ nullable: true }) governmentId!: string | null;
}

export class IdentityLookupDto {
  @ApiProperty({ example: 'alice@example.com' })
  @IsEmail()
  @MaxLength(254)
  email!: string;
}
