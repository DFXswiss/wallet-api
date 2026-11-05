import { Module } from '@nestjs/common';
import { OutboundModule } from '../outbound/outbound.module';
import { PricesController } from './prices.controller';
import { PricesService } from './prices.service';

@Module({
  imports: [OutboundModule],
  controllers: [PricesController],
  providers: [PricesService],
})
export class PricesModule {}
