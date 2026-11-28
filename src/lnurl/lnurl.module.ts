import { Module } from '@nestjs/common';
import { WalletConfigModule } from '../config/config.module';
import { OutboundModule } from '../outbound/outbound.module';
import { LnurlController } from './lnurl.controller';
import { LnurlService } from './lnurl.service';

@Module({
  imports: [OutboundModule, WalletConfigModule],
  controllers: [LnurlController],
  providers: [LnurlService],
})
export class LnurlModule {}
