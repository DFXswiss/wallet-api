import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';
import { FEE_RATE_CHOICES, FeeRateChoice, MAX_FEE_RATE_SAT_PER_VB } from './fee-estimates';
import { MAX_WALLET_ADDRESSES } from './bitcoin-limits';

export const AMOUNT_PATTERN = /^(max|[1-9][0-9]{0,15})$/;

// The decorators check only JSON type and presence (400 `BadRequest`). Count, format, and range are checked by
// BitcoinService, which answers the documented codes (`AddressInvalid`, `DestinationInvalid`, `AmountInvalid`,
// `FeeRateChoiceInvalid`, ...).
export class BitcoinPrepareRequestDto {
  @ApiProperty({
    description: 'The wallet addresses whose UTXOs may be spent (BIP-84 P2WPKH on the route network).',
    type: [String],
    minItems: 1,
    maxItems: MAX_WALLET_ADDRESSES,
  })
  @IsArray()
  @IsString({ each: true })
  addresses: string[];

  @ApiProperty({ description: 'P2WPKH change address on the route network, derived by the device.' })
  @IsString()
  changeAddress: string;

  @ApiProperty({ description: 'P2PKH, P2SH, P2WPKH, P2WSH, or P2TR address on the route network.' })
  @IsString()
  destination: string;

  @ApiProperty({
    description: 'Integer sats as a decimal string, or `max`.',
    example: '150000',
    pattern: '^(max|[1-9][0-9]{0,15})$',
  })
  @IsString()
  amount: string;

  @ApiPropertyOptional({ enum: [...FEE_RATE_CHOICES], description: 'Exactly one of `feeRate` and `feeRateSatPerVb`.' })
  @IsOptional()
  @IsString()
  feeRate?: FeeRateChoice;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_FEE_RATE_SAT_PER_VB,
    type: 'integer',
    description: 'Integer sat/vB.',
  })
  @IsOptional()
  @IsNumber()
  feeRateSatPerVb?: number;

  @ApiPropertyOptional({ default: true, description: 'Signal BIP-125 replace-by-fee (sequence 0xfffffffd).' })
  @IsOptional()
  @IsBoolean()
  rbf?: boolean;

  @ApiPropertyOptional({ default: false, description: 'Also spend unconfirmed UTXOs.' })
  @IsOptional()
  @IsBoolean()
  includeUnconfirmed?: boolean;

  @ApiPropertyOptional({
    default: false,
    description: 'Allow a destination that is one of `addresses` or `changeAddress`.',
  })
  @IsOptional()
  @IsBoolean()
  allowOwnDestination?: boolean;
}

export class BitcoinPreparedInputDto {
  @ApiProperty()
  txid: string;

  @ApiProperty()
  vout: number;

  @ApiProperty({ description: 'Sats.' })
  value: number;

  @ApiProperty({ description: 'The wallet address that owns the UTXO; the device signs with its key.' })
  address: string;
}

export class BitcoinPreparedOutputDto {
  @ApiProperty()
  address: string;

  @ApiProperty({ description: 'Sats.' })
  value: number;

  @ApiProperty({ enum: ['destination', 'change'] })
  kind: 'destination' | 'change';
}

export class BitcoinPrepareResponseDto {
  @ApiProperty({ description: 'Pass to submit.' })
  prepareId: string;

  @ApiProperty()
  expiresAt: string;

  @ApiProperty()
  blockchain: string;

  @ApiProperty({ description: 'Unsigned BIP-174 PSBT, base64. Each input carries witnessUtxo; no BIP-32 paths.' })
  psbt: string;

  @ApiProperty({ description: 'Txid the signed transaction will have.' })
  txid: string;

  @ApiProperty()
  destination: string;

  @ApiProperty({ description: 'Sats reaching the destination.' })
  amount: number;

  @ApiProperty({ description: 'Sats.' })
  fee: number;

  @ApiProperty({ description: 'sat/vB used.' })
  feeRate: number;

  @ApiProperty({ description: 'Sats; 0 when there is no change output.' })
  change: number;

  @ApiProperty({ type: String, nullable: true })
  changeAddress: string | null;

  @ApiProperty({ description: 'Change below the dust threshold added to the fee, in sats.' })
  changeAddedToFee: number;

  @ApiProperty({ description: 'Estimated virtual size of the signed transaction.' })
  vsize: number;

  @ApiProperty()
  rbf: boolean;

  @ApiProperty({ description: 'Sats.' })
  totalInput: number;

  @ApiProperty({ description: 'UTXOs not spent because they cost more to spend than they are worth.' })
  uneconomicalUtxos: number;

  @ApiProperty({ type: [BitcoinPreparedInputDto] })
  inputs: BitcoinPreparedInputDto[];

  @ApiProperty({ type: [BitcoinPreparedOutputDto], description: 'In transaction order.' })
  outputs: BitcoinPreparedOutputDto[];
}
