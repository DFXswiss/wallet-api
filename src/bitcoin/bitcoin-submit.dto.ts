import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

// The decorators check only JSON type and presence (400 `BadRequest`). Format and size are checked by BitcoinService,
// which answers the documented codes (`PrepareNotFound`, `SubmitPayloadInvalid`, `TransactionInvalid`, ...).
export class BitcoinSubmitRequestDto {
  @ApiProperty({ description: 'The id returned by prepare.', format: 'uuid' })
  @IsString()
  prepareId: string;

  @ApiPropertyOptional({ description: 'Signed transaction, hex. Exactly one of `transactionHex` and `psbt`.' })
  @IsOptional()
  @IsString()
  transactionHex?: string;

  @ApiPropertyOptional({ description: 'Signed (finalized or not) PSBT, base64.' })
  @IsOptional()
  @IsString()
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
