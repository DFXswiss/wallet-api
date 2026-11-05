import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { AddressesService } from './addresses.service';
import { UpsertAddressDto } from './addresses.dto';

@ApiTags('addresses')
@ApiBearerAuth()
@UseGuards(SessionGuard)
@Controller('wallet/addresses')
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Put()
  upsert(@Req() request: AuthenticatedRequest, @Body() dto: UpsertAddressDto) {
    return this.addresses.upsert(request.walletAccountId, dto);
  }

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.addresses.list(request.walletAccountId);
  }
}
