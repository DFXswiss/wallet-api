import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OptionalSessionGuard } from '../auth/optional-session.guard';
import { AuthenticatedRequest } from '../auth/session.guard';
import { walletError } from '../common/wallet-error';
import { DiagnosticsService } from './diagnostics.service';

const MAX_DIAGNOSTIC_BYTES = 16 * 1024;

@ApiTags('diagnostics')
@Controller('wallet/diagnostics')
export class DiagnosticsController {
  constructor(private readonly diagnostics: DiagnosticsService) {}

  @Post()
  @HttpCode(201)
  @UseGuards(OptionalSessionGuard)
  async store(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw walletError(400, 'DiagnosticInvalid');
    }
    const payload = body as Record<string, unknown>;
    let serialized: string;
    try {
      serialized = JSON.stringify(payload);
    } catch {
      throw walletError(400, 'DiagnosticInvalid');
    }
    if (!serialized || Buffer.byteLength(serialized, 'utf8') > MAX_DIAGNOSTIC_BYTES) {
      throw walletError(413, 'DiagnosticTooLarge');
    }
    await this.diagnostics.store(request.walletAccountId ?? null, payload);
    return { accepted: true };
  }
}
