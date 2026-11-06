import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WalletDataService } from './wallet-data.service';

@ApiTags('wallet')
@Controller('wallet')
export class WalletController {
  constructor(private readonly data: WalletDataService) {}

  @Get('chains')
  chains() {
    return this.data.chains();
  }

  @Get('lists/:id')
  list(@Param('id') id: string) {
    return this.data.list(id);
  }
}
