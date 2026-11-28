import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { WalletConfigResponse, WalletFamilies } from './wallet-families';

class WalletFamiliesDto {
  @ApiProperty({ description: 'Bitcoin on-chain', example: true })
  bitcoin: boolean;

  @ApiProperty({ description: 'Spark and Lightning', example: false })
  spark: boolean;

  @ApiProperty({ description: 'EVM chains', example: false })
  evm: boolean;
}

class WalletConfigDto implements WalletConfigResponse {
  @ApiProperty({ type: WalletFamiliesDto })
  families: WalletFamiliesDto;
}

@ApiTags('config')
@Controller('wallet/config')
export class WalletConfigController {
  constructor(private readonly families: WalletFamilies) {}

  // Public: the app shows exactly the families that are true here.
  @Get()
  @ApiOkResponse({ type: WalletConfigDto })
  get(): WalletConfigResponse {
    return this.families.toResponse();
  }
}
