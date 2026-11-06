import { Module } from '@nestjs/common';
import { ProxyModule } from '../proxy/proxy.module';
import { EnsController } from './ens.controller';
import { EnsService } from './ens.service';

@Module({
  imports: [ProxyModule],
  controllers: [EnsController],
  providers: [EnsService],
})
export class EnsModule {}
