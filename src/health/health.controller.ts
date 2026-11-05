import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('wallet/health')
export class HealthController {
  @Get()
  health() {
    return { status: 'ok' };
  }
}
