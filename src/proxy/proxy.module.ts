import { Module } from '@nestjs/common';
import { WalletConfigModule } from '../config/config.module';
import { OutboundModule } from '../outbound/outbound.module';
import { ProxyController } from './proxy.controller';
import { ProxyService } from './proxy.service';

@Module({
  imports: [OutboundModule, WalletConfigModule],
  controllers: [ProxyController],
  providers: [ProxyService],
  exports: [ProxyService],
})
export class ProxyModule {}
