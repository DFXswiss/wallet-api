import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { PasskeyConfiguredGuard } from './passkey-configured.guard';
import { PasskeyService } from './passkey.service';

@ApiTags('passkeys')
@Controller('wallet')
export class PasskeyController {
  constructor(private readonly passkeys: PasskeyService) {}

  @Post('register/begin')
  @HttpCode(200)
  @UseGuards(PasskeyConfiguredGuard)
  async beginRegistration() {
    const result = await this.passkeys.beginRegistration();
    return {
      ...result.options,
      rpId: result.rpId,
      rpName: result.rpName,
      challengeId: result.challengeId,
      userHandle: result.userHandle,
    };
  }

  @Post('register/finish')
  @HttpCode(200)
  @UseGuards(PasskeyConfiguredGuard)
  finishRegistration(@Body() body: unknown) {
    return this.passkeys.finishRegistration(body);
  }

  @Post('authenticate/begin')
  @HttpCode(200)
  @UseGuards(PasskeyConfiguredGuard)
  async beginAuthentication(@Body() body: { credentialId?: unknown } | undefined) {
    const result = await this.passkeys.beginAuthentication(body?.credentialId);
    return { ...result.options, challengeId: result.challengeId };
  }

  @Post('authenticate/finish')
  @HttpCode(200)
  @UseGuards(PasskeyConfiguredGuard)
  finishAuthentication(@Body() body: unknown) {
    return this.passkeys.finishAuthentication(body);
  }

  @Post('revoke/begin')
  @HttpCode(200)
  @ApiBearerAuth()
  @UseGuards(PasskeyConfiguredGuard, SessionGuard)
  async beginRevocation(@Req() request: AuthenticatedRequest) {
    const result = await this.passkeys.beginRevocation(request.walletAccountId);
    return { ...result.options, challengeId: result.challengeId };
  }

  @Post('revoke/finish')
  @HttpCode(200)
  @ApiBearerAuth()
  @UseGuards(PasskeyConfiguredGuard, SessionGuard)
  finishRevocation(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.passkeys.finishRevocation(request.walletAccountId, body);
  }

  @Get('credentials')
  @ApiBearerAuth()
  @UseGuards(PasskeyConfiguredGuard, SessionGuard)
  listCredentials(@Req() request: AuthenticatedRequest) {
    return this.passkeys.listCredentials(request.walletAccountId);
  }
}
