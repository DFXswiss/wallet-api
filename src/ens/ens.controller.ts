import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EnsService } from './ens.service';

@ApiTags('ens')
@Controller('wallet/ens')
export class EnsController {
  constructor(private readonly ens: EnsService) {}

  @Get('address')
  address(@Query('name') name: string | undefined) {
    return this.ens.address(name);
  }

  @Get('name')
  name(@Query('address') address: string | undefined) {
    return this.ens.name(address);
  }
}
