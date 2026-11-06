import { Module } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import { WalletDataService } from './wallet-data.service';

@Module({
  controllers: [WalletController],
  providers: [WalletDataService],
  exports: [WalletDataService],
})
export class WalletModule {}
