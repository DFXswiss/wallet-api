import { Module } from '@nestjs/common';
import { OutboundModule } from '../outbound/outbound.module';
import { LnurlController } from './lnurl.controller';
import { LnurlService } from './lnurl.service';

@Module({
  imports: [OutboundModule],
  controllers: [LnurlController],
  providers: [LnurlService],
})
export class LnurlModule {}
