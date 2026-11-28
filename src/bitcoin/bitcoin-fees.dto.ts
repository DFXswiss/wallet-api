import { ApiProperty } from '@nestjs/swagger';

export class BitcoinFeeRatesDto {
  @ApiProperty({ description: 'sat/vB, target 1 block.' })
  fast: number;

  @ApiProperty({ description: 'sat/vB, target 6 blocks.' })
  normal: number;

  @ApiProperty({ description: 'sat/vB, target 144 blocks.' })
  slow: number;
}

export class BitcoinFeesResponseDto {
  @ApiProperty()
  blockchain: string;

  @ApiProperty({
    enum: ['esplora', 'fallback'],
    description: '`fallback` only on BitcoinTestnet4 and BitcoinRegtest outside prd, when Esplora has no estimate.',
  })
  source: 'esplora' | 'fallback';

  @ApiProperty({ enum: ['sat/vB'] })
  unit: 'sat/vB';

  @ApiProperty({ type: BitcoinFeeRatesDto })
  rates: BitcoinFeeRatesDto;
}
