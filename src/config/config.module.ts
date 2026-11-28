import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseEnvironment } from './environment';
import { RelyingPartyService } from './relying-party.service';
import { WalletConfigController } from './wallet-config.controller';
import { WalletFamilies, readWalletFamilies } from './wallet-families';

// Read once at boot. A missing or unknown ENVIRONMENT or an invalid switch stops the application.
export function createWalletFamilies(config: ConfigService): WalletFamilies {
  return new WalletFamilies(readWalletFamilies(parseEnvironment(config.get<string>('ENVIRONMENT'))));
}

@Module({
  controllers: [WalletConfigController],
  providers: [
    RelyingPartyService,
    { provide: WalletFamilies, inject: [ConfigService], useFactory: createWalletFamilies },
  ],
  exports: [RelyingPartyService, WalletFamilies],
})
export class WalletConfigModule {}
