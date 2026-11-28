import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { MAX_RAW_TRANSACTION_BYTES } from './raw-transaction';

export class BitcoinSubmitRequestDto {
  @ApiProperty({ description: 'The id returned by prepare.' })
  @IsUUID()
  prepareId: string;

  @ApiPropertyOptional({ description: 'Signed transaction, hex. Exactly one of `transactionHex` and `psbt`.' })
  @IsOptional()
  @IsString()
  @Length(2, MAX_RAW_TRANSACTION_BYTES * 2)
  transactionHex?: string;

  @ApiPropertyOptional({ description: 'Signed (finalized or not) PSBT, base64.' })
  @IsOptional()
  @IsString()
  @Length(4, MAX_RAW_TRANSACTION_BYTES * 3)
  psbt?: string;
}

export class BitcoinSubmitResponseDto {
  @ApiProperty()
  txid: string;

  @ApiProperty()
  prepareId: string;

  @ApiProperty({ description: 'True when the transaction had already been submitted or was already known upstream.' })
  alreadySubmitted: boolean;
}
