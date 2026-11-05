import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { walletError } from '../common/wallet-error';
import { WalletAccount } from '../entities/wallet-account.entity';
import { SessionService, sessionStillCurrent } from './session.service';

@Injectable()
export class SessionAccountService {
  constructor(
    private readonly sessions: SessionService,
    @InjectRepository(WalletAccount)
    private readonly accounts: Repository<WalletAccount>,
  ) {}

  async requireAccountId(token: string): Promise<string> {
    const claims = await this.sessions.verify(token);
    const account = await this.accounts.findOneBy({ id: claims.sub });
    if (!account || !sessionStillCurrent(claims.iat, account.sessionValidAfter)) {
      throw walletError(401, 'SessionInvalid');
    }
    return account.id;
  }
}
