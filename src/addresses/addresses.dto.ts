import { IsIn, IsString, Length } from 'class-validator';
import { WalletChainId } from '../entities/passkey-address.entity';

export class UpsertAddressDto {
  @IsIn(['bitcoin', 'ethereum', 'spark'])
  chain: WalletChainId;

  @IsString()
  @Length(1, 512)
  address: string;
}
