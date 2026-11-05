import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { WalletConfigModule } from '../config/config.module';
import { PasskeyChallenge } from '../entities/passkey-challenge.entity';
import { PasskeyCredential } from '../entities/passkey-credential.entity';
import { PasskeyController } from './passkey.controller';
import { PasskeyService } from './passkey.service';
import { PasskeyConfiguredGuard } from './passkey-configured.guard';
import { SimpleWebAuthnVerifier, WEBAUTHN_VERIFIER } from './webauthn.verifier';

@Module({
  imports: [TypeOrmModule.forFeature([PasskeyCredential, PasskeyChallenge]), WalletConfigModule, AuthModule],
  controllers: [PasskeyController],
  providers: [
    PasskeyService,
    PasskeyConfiguredGuard,
    SimpleWebAuthnVerifier,
    { provide: WEBAUTHN_VERIFIER, useExisting: SimpleWebAuthnVerifier },
  ],
  exports: [PasskeyService, WEBAUTHN_VERIFIER],
})
export class PasskeyModule {}
