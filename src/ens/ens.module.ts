import { Module } from '@nestjs/common';
import { WalletConfigModule } from '../config/config.module';
import { ProxyModule } from '../proxy/proxy.module';
import { EnsController } from './ens.controller';
import { EnsService } from './ens.service';

@Module({
  imports: [ProxyModule, WalletConfigModule],
  controllers: [EnsController],
  providers: [EnsService],
})
export class EnsModule {}
