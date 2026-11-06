import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AddressesModule } from './addresses/addresses.module';
import { AuthModule } from './auth/auth.module';
import { WalletConfigModule } from './config/config.module';
import { validateEnvironment } from './config/environment';
import { DiagnosticsModule } from './diagnostics/diagnostics.module';
import { EnsModule } from './ens/ens.module';
import { PasskeyAddress } from './entities/passkey-address.entity';
import { PasskeyChallenge } from './entities/passkey-challenge.entity';
import { PasskeyCredential } from './entities/passkey-credential.entity';
import { PasskeyDiagnostic } from './entities/passkey-diagnostic.entity';
import { WalletAccount } from './entities/wallet-account.entity';
import { HealthModule } from './health/health.module';
import { LnurlModule } from './lnurl/lnurl.module';
import { OutboundModule } from './outbound/outbound.module';
import { PasskeyModule } from './passkey/passkey.module';
import { PricesModule } from './prices/prices.module';
import { ProxyModule } from './proxy/proxy.module';
import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'postgres' as const,
        url: process.env.DATABASE_URL,
        entities: [WalletAccount, PasskeyCredential, PasskeyChallenge, PasskeyAddress, PasskeyDiagnostic],
        migrations: [__dirname + '/migrations/*{.ts,.js}'],
        synchronize: false,
        migrationsRun: false,
      }),
    }),
    WalletConfigModule,
    OutboundModule,
    AuthModule,
    HealthModule,
    PasskeyModule,
    AddressesModule,
    DiagnosticsModule,
    WalletModule,
    ProxyModule,
    PricesModule,
    LnurlModule,
    EnsModule,
  ],
})
export class AppModule {}
