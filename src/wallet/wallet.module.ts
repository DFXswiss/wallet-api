import { Module } from '@nestjs/common';
import { WalletConfigModule } from '../config/config.module';
import { WalletController } from './wallet.controller';
import { WalletDataService } from './wallet-data.service';

@Module({
  imports: [WalletConfigModule],
  controllers: [WalletController],
  providers: [WalletDataService],
  exports: [WalletDataService],
})
export class WalletModule {}
