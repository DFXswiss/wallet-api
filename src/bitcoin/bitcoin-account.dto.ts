import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT } from './account-view';
import { MAX_ADDRESS_LENGTH, MAX_WALLET_ADDRESSES, MIN_ADDRESS_LENGTH } from './bitcoin-limits';

export class BitcoinAccountRequestDto {
  @ApiProperty({
    description: 'BIP-84 receive and change addresses derived by the device (P2WPKH on the route network).',
    type: [String],
    minItems: 1,
    maxItems: MAX_WALLET_ADDRESSES,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_WALLET_ADDRESSES)
  @ArrayUnique()
  @IsString({ each: true })
  @Length(MIN_ADDRESS_LENGTH, MAX_ADDRESS_LENGTH, { each: true })
  addresses: string[];

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_HISTORY_LIMIT, default: DEFAULT_HISTORY_LIMIT })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_HISTORY_LIMIT)
  historyLimit?: number;
}

export class BitcoinBalanceDto {
  @ApiProperty({ description: 'Confirmed balance in sats.' })
  confirmed: number;

  @ApiProperty({ description: 'Unconfirmed change in sats; negative while a spend is in the mempool.' })
  unconfirmed: number;

  @ApiProperty({ description: 'confirmed + unconfirmed, in sats.' })
  total: number;
}

export class BitcoinAddressViewDto extends BitcoinBalanceDto {
  @ApiProperty()
  address: string;

  @ApiProperty({ description: 'Confirmed plus unconfirmed transactions touching the address.' })
  txCount: number;

  @ApiProperty({ description: 'True when the address has history. The device runs gap-limit discovery with it.' })
  used: boolean;
}

export class BitcoinUtxoDto {
  @ApiProperty()
  txid: string;

  @ApiProperty()
  vout: number;

  @ApiProperty({ description: 'Sats.' })
  value: number;

  @ApiProperty()
  address: string;

  @ApiProperty()
  confirmed: boolean;

  @ApiProperty({ type: Number, nullable: true })
  height: number | null;

  @ApiProperty()
  confirmations: number;
}

export class BitcoinHistoryEntryDto {
  @ApiProperty()
  txid: string;

  @ApiProperty()
  confirmed: boolean;

  @ApiProperty({ type: Number, nullable: true })
  height: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Block time, Unix seconds.' })
  time: number | null;

  @ApiProperty()
  confirmations: number;

  @ApiProperty({ description: 'Sats received minus sats spent by the given addresses; includes the fee it paid.' })
  netAmount: number;

  @ApiProperty({ description: 'Whole transaction fee in sats.' })
  fee: number;

  @ApiProperty({ enum: ['incoming', 'outgoing', 'self'] })
  direction: 'incoming' | 'outgoing' | 'self';
}

export class BitcoinAccountResponseDto {
  @ApiProperty()
  blockchain: string;

  @ApiProperty()
  tipHeight: number;

  @ApiProperty({ type: BitcoinBalanceDto })
  balance: BitcoinBalanceDto;

  @ApiProperty({ type: [BitcoinAddressViewDto] })
  addresses: BitcoinAddressViewDto[];

  @ApiProperty({ type: [BitcoinUtxoDto] })
  utxos: BitcoinUtxoDto[];

  @ApiProperty({ type: [BitcoinHistoryEntryDto], description: 'Unconfirmed first, then newest first.' })
  history: BitcoinHistoryEntryDto[];

  @ApiProperty()
  historyLimit: number;

  @ApiProperty({ description: 'False when older transactions exist that are not in `history`.' })
  historyComplete: boolean;
}
