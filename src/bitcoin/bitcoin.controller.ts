import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { BitcoinAccountRequestDto, BitcoinAccountResponseDto } from './bitcoin-account.dto';
import { BitcoinFamilyGuard } from './bitcoin-family.guard';
import { BitcoinFeesResponseDto } from './bitcoin-fees.dto';
import { BITCOIN_NETWORKS } from './bitcoin-network';
import { BitcoinPrepareRequestDto, BitcoinPrepareResponseDto } from './bitcoin-prepare.dto';
import { BitcoinSubmitRequestDto, BitcoinSubmitResponseDto } from './bitcoin-submit.dto';
import { BitcoinService } from './bitcoin.service';

@ApiTags('bitcoin')
@ApiBearerAuth()
@ApiParam({
  name: 'blockchain',
  enum: Object.keys(BITCOIN_NETWORKS),
  description: 'An Esplora blockchain id that is configured in this environment; others answer 404.',
})
@UseGuards(BitcoinFamilyGuard, SessionGuard)
@Controller('wallet/bitcoin/:blockchain')
export class BitcoinController {
  constructor(private readonly bitcoin: BitcoinService) {}

  @Post('account')
  @HttpCode(200)
  @ApiOkResponse({ type: BitcoinAccountResponseDto })
  account(@Param('blockchain') blockchain: string, @Body() dto: BitcoinAccountRequestDto) {
    return this.bitcoin.account(blockchain, dto);
  }

  @Get('fees')
  @ApiOkResponse({ type: BitcoinFeesResponseDto })
  fees(@Param('blockchain') blockchain: string) {
    return this.bitcoin.fees(blockchain);
  }

  @Post('prepare')
  @HttpCode(201)
  @ApiCreatedResponse({ type: BitcoinPrepareResponseDto })
  prepare(
    @Req() request: AuthenticatedRequest,
    @Param('blockchain') blockchain: string,
    @Body() dto: BitcoinPrepareRequestDto,
  ) {
    return this.bitcoin.prepare(request.walletAccountId, blockchain, dto);
  }

  @Post('submit')
  @HttpCode(200)
  @ApiOkResponse({ type: BitcoinSubmitResponseDto })
  submit(
    @Req() request: AuthenticatedRequest,
    @Param('blockchain') blockchain: string,
    @Body() dto: BitcoinSubmitRequestDto,
  ) {
    return this.bitcoin.submit(request.walletAccountId, blockchain, dto);
  }
}
