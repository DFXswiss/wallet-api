import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { walletError } from '../common/wallet-error';
import { PasskeyAddress } from '../entities/passkey-address.entity';
import { UpsertAddressDto } from './addresses.dto';

@Injectable()
export class AddressesService {
  constructor(
    @InjectRepository(PasskeyAddress)
    private readonly addresses: Repository<PasskeyAddress>,
    private readonly dataSource: DataSource,
  ) {}

  async upsert(walletAccountId: string, dto: UpsertAddressDto) {
    const existing = await this.addresses.findOneBy({ walletAccountId, chain: dto.chain });
    if (existing) {
      if (existing.address !== dto.address) {
        throw walletError(409, 'AddressConflict');
      }
      return { chain: existing.chain, address: existing.address };
    }
    try {
      const saved = await this.dataSource.transaction(async (manager) => {
        const record = manager.create(PasskeyAddress, {
          walletAccountId,
          chain: dto.chain,
          address: dto.address,
        });
        return manager.save(record);
      });
      return { chain: saved.chain, address: saved.address };
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        const current = await this.addresses.findOneBy({ walletAccountId, chain: dto.chain });
        if (current && current.address === dto.address) {
          return { chain: current.chain, address: current.address };
        }
        throw walletError(409, 'AddressConflict');
      }
      throw error;
    }
  }

  async list(walletAccountId: string) {
    const records = await this.addresses.find({
      where: { walletAccountId },
      order: { chain: 'ASC' },
    });
    return records.map((record) => ({ chain: record.chain, address: record.address }));
  }
}
