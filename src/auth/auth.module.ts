import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { OptionalSessionGuard } from './optional-session.guard';
import { SessionGuard } from './session.guard';
import { SessionService } from './session.service';

@Module({
  imports: [JwtModule.register({})],
  providers: [SessionService, SessionGuard, OptionalSessionGuard],
  exports: [SessionService, SessionGuard, OptionalSessionGuard, JwtModule],
})
export class AuthModule {}
