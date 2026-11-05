import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PricesService } from './prices.service';

@ApiTags('prices')
@Controller('wallet/prices')
export class PricesController {
  constructor(private readonly prices: PricesService) {}

  @Get()
  get() {
    return this.prices.prices();
  }
}
