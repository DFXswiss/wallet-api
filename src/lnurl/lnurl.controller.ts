import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { LnurlService } from './lnurl.service';

@ApiTags('lnurl')
@Controller('wallet')
export class LnurlController {
  constructor(private readonly lnurl: LnurlService) {}

  @Get('lnurl')
  resolve(@Query('url') url: string | undefined) {
    return this.lnurl.resolve(url);
  }

  @Get('lightning-address/:address')
  lightning(@Param('address') address: string) {
    return this.lnurl.lightningAddress(address);
  }
}
