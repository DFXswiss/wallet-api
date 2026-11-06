import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletAccount } from '../entities/wallet-account.entity';
import { OptionalSessionGuard } from './optional-session.guard';
import { SessionAccountService } from './session-account.service';
import { SessionGuard } from './session.guard';
import { SessionService } from './session.service';

@Module({
  imports: [JwtModule.register({}), TypeOrmModule.forFeature([WalletAccount])],
  providers: [SessionService, SessionAccountService, SessionGuard, OptionalSessionGuard],
  exports: [SessionService, SessionAccountService, SessionGuard, OptionalSessionGuard, JwtModule],
})
export class AuthModule {}
