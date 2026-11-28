import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { BitcoinPreparedPayment } from '../entities/bitcoin-prepared-payment.entity';
import { ProxyModule } from '../proxy/proxy.module';
import { BitcoinFamilyGuard } from './bitcoin-family.guard';
import { BitcoinPaymentStore } from './bitcoin-payment.store';
import { BitcoinController } from './bitcoin.controller';
import { BitcoinService } from './bitcoin.service';

@Module({
  imports: [TypeOrmModule.forFeature([BitcoinPreparedPayment]), AuthModule, ProxyModule],
  controllers: [BitcoinController],
  providers: [BitcoinService, BitcoinPaymentStore, BitcoinFamilyGuard],
})
export class BitcoinModule {}
