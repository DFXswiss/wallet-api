import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { WalletConfigModule } from '../config/config.module';
import { PasskeyAddress } from '../entities/passkey-address.entity';
import { AddressesController } from './addresses.controller';
import { AddressesService } from './addresses.service';

@Module({
  imports: [TypeOrmModule.forFeature([PasskeyAddress]), AuthModule, WalletConfigModule],
  controllers: [AddressesController],
  providers: [AddressesService],
})
export class AddressesModule {}
