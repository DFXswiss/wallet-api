import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { RelyingPartyService } from '../config/relying-party.service';
import { walletError } from '../common/wallet-error';
import { PasskeyChallenge } from '../entities/passkey-challenge.entity';
import { PasskeyCredential } from '../entities/passkey-credential.entity';
import { WalletAccount } from '../entities/wallet-account.entity';
import { SessionService } from '../auth/session.service';
import {
  WEBAUTHN_VERIFIER,
  WebAuthnVerifier,
  hasPrfResults,
  readAuthenticatorAttachment,
  type PasskeyResponseLike,
} from './webauthn.verifier';

const CHALLENGE_TTL_SECONDS = 600;
export const MAX_LIVE_CHALLENGES = 1000;
const CHALLENGE_ADVISORY_LOCK = '481201001';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RegisterBeginResult = {
  options: PublicKeyCredentialCreationOptionsJSON;
  challengeId: string;
  userHandle: string;
  rpId: string;
  rpName: string;
};

export type AuthenticateBeginResult = {
  options: PublicKeyCredentialRequestOptionsJSON;
  challengeId: string;
};

@Injectable()
export class PasskeyService {
  constructor(
    @InjectRepository(PasskeyCredential)
    private readonly credentials: Repository<PasskeyCredential>,
    @InjectRepository(PasskeyChallenge)
    private readonly challenges: Repository<PasskeyChallenge>,
    private readonly relyingParty: RelyingPartyService,
    private readonly sessions: SessionService,
    private readonly dataSource: DataSource,
    @Inject(WEBAUTHN_VERIFIER)
    private readonly verifier: WebAuthnVerifier,
  ) {}

  async beginRegistration(): Promise<RegisterBeginResult> {
    const rp = this.relyingParty.assertConfigured();
    const challengeId = randomUUID();
    const userHandle = Buffer.from(challengeId, 'utf8').toString('base64url');
    const options = await generateRegistrationOptions({
      rpID: rp.rpId,
      rpName: 'DFX',
      userName: userHandle,
      userDisplayName: userHandle,
      userID: Buffer.from(challengeId, 'utf8'),
      attestationType: 'none',
      timeout: 60_000,
      supportedAlgorithmIDs: [-7, -257],
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
        authenticatorAttachment: 'platform',
      },
      extensions: undefined,
    });
    const stored = await this.storeChallenge(options.challenge, 'register', null, challengeId);
    return { options, challengeId: stored.id, userHandle, rpId: rp.rpId, rpName: 'DFX' };
  }

  async finishRegistration(body: unknown): Promise<{ token: string; accountId: string }> {
    const rp = this.relyingParty.assertConfigured();
    const payload = (body ?? {}) as Record<string, unknown>;
    const response = payload.response as (RegistrationResponseJSON & PasskeyResponseLike) | undefined;
    const challengeId = payload.challengeId;
    if (!response || typeof response !== 'object' || !response.response) {
      throw walletError(400, 'ChallengeInvalid');
    }
    if (hasPrfResults(response)) {
      throw walletError(400, 'PrfResultsRefused');
    }
    if (readAuthenticatorAttachment(response) === 'cross-platform') {
      throw walletError(400, 'CrossDeviceRegistration');
    }
    const challenge = await this.findUsableChallenge(response.response?.clientDataJSON, challengeId, 'register');
    const userHandle = Buffer.from(challenge.id, 'utf8').toString('base64url');
    const verified = await this.verifier.verifyRegistration({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpId,
    });
    if (!verified.verified || !verified.credentialId || !verified.publicKey) {
      throw walletError(400, 'ChallengeInvalid');
    }
    return this.dataSource.transaction(async (manager) => {
      await this.deleteUsableChallenge(manager, challenge.id, new Date());
      const account = manager.create(WalletAccount, {});
      await manager.save(account);
      const credential = manager.create(PasskeyCredential, {
        walletAccountId: account.id,
        credentialId: verified.credentialId,
        publicKey: verified.publicKey,
        userHandle,
        backupEligible: verified.backupEligible,
        backedUp: verified.backedUp,
        aaguid: verified.aaguid ?? null,
        transports: JSON.stringify(verified.transports ?? []),
        revokedAt: null,
      });
      await manager.save(credential);
      return { token: this.sessions.issue(account.id), accountId: account.id };
    });
  }

  async beginAuthentication(credentialIdInput: unknown): Promise<AuthenticateBeginResult> {
    const rp = this.relyingParty.assertConfigured();
    let allowCredentials: { id: string; type: 'public-key'; transports?: any[] }[] | undefined;
    if (credentialIdInput !== undefined) {
      if (typeof credentialIdInput !== 'string' || credentialIdInput.length === 0) {
        throw walletError(404, 'PasskeyCredentialNotFound');
      }
      const credential = await this.credentials.findOneBy({ credentialId: credentialIdInput });
      if (!credential) {
        throw walletError(404, 'PasskeyCredentialNotFound');
      }
      if (credential.revokedAt) {
        throw walletError(401, 'PasskeyCredentialRevoked');
      }
      allowCredentials = [
        { id: credential.credentialId, type: 'public-key', transports: this.parseTransports(credential) },
      ];
    }
    const options = await generateAuthenticationOptions({
      rpID: rp.rpId,
      timeout: 60_000,
      userVerification: 'required',
      allowCredentials,
    });
    const stored = await this.storeChallenge(options.challenge, 'authenticate', null);
    return { options, challengeId: stored.id };
  }

  async finishAuthentication(body: unknown): Promise<{ token: string; accountId: string }> {
    const rp = this.relyingParty.assertConfigured();
    const payload = (body ?? {}) as Record<string, unknown>;
    const response = payload.response as (AuthenticationResponseJSON & PasskeyResponseLike) | undefined;
    const challengeId = payload.challengeId;
    if (!response || typeof response !== 'object' || typeof response.id !== 'string' || !response.response) {
      throw walletError(400, 'ChallengeInvalid');
    }
    if (hasPrfResults(response)) {
      throw walletError(400, 'PrfResultsRefused');
    }
    const credential = await this.credentials.findOneBy({ credentialId: response.id });
    if (!credential) {
      throw walletError(404, 'PasskeyCredentialNotFound');
    }
    if (credential.revokedAt) {
      throw walletError(401, 'PasskeyCredentialRevoked');
    }
    const challenge = await this.findUsableChallenge(response.response?.clientDataJSON, challengeId, 'authenticate');
    const verified = await this.verifier.verifyAuthentication({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpId,
      credential: {
        id: credential.credentialId,
        publicKey: credential.publicKey,
        counter: 0,
        transports: this.parseTransports(credential),
      },
    });
    if (!verified.verified) {
      throw walletError(400, 'ChallengeInvalid');
    }
    return this.dataSource.transaction(async (manager) => {
      const fresh = await manager
        .createQueryBuilder(PasskeyCredential, 'credential')
        .setLock('pessimistic_write')
        .where('credential.id = :id', { id: credential.id })
        .getOne();
      if (!fresh || fresh.revokedAt) {
        throw walletError(401, 'PasskeyCredentialRevoked');
      }
      await this.deleteUsableChallenge(manager, challenge.id, new Date());
      return { token: this.sessions.issue(credential.walletAccountId), accountId: credential.walletAccountId };
    });
  }

  async beginRevocation(walletAccountId: string): Promise<AuthenticateBeginResult> {
    const rp = this.relyingParty.assertConfigured();
    const credentials = await this.credentials.findBy({ walletAccountId });
    const active = credentials.filter((credential) => !credential.revokedAt);
    if (active.length === 0) {
      throw walletError(404, 'PasskeyCredentialNotFound');
    }
    const options = await generateAuthenticationOptions({
      rpID: rp.rpId,
      timeout: 60_000,
      userVerification: 'required',
      allowCredentials: active.map((credential) => ({
        id: credential.credentialId,
        type: 'public-key' as const,
        transports: this.parseTransports(credential),
      })),
    });
    const stored = await this.storeChallenge(options.challenge, 'revoke', walletAccountId);
    return { options, challengeId: stored.id };
  }

  async finishRevocation(walletAccountId: string, body: unknown): Promise<{ revokedAt: string }> {
    const rp = this.relyingParty.assertConfigured();
    const payload = (body ?? {}) as Record<string, unknown>;
    const response = payload.response as (AuthenticationResponseJSON & PasskeyResponseLike) | undefined;
    if (!response || typeof response !== 'object' || typeof response.id !== 'string' || !response.response) {
      throw walletError(400, 'ChallengeInvalid');
    }
    if (hasPrfResults(response)) {
      throw walletError(400, 'PrfResultsRefused');
    }
    const credential = await this.credentials.findOneBy({ credentialId: response.id, walletAccountId });
    if (!credential) {
      throw walletError(404, 'PasskeyCredentialNotFound');
    }
    if (credential.revokedAt) {
      throw walletError(401, 'PasskeyCredentialRevoked');
    }
    const challenge = await this.findUsableChallenge(response.response?.clientDataJSON, payload.challengeId, 'revoke');
    if (challenge.walletAccountId !== walletAccountId) {
      throw walletError(400, 'ChallengeInvalid');
    }
    const verified = await this.verifier.verifyAuthentication({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpId,
      credential: {
        id: credential.credentialId,
        publicKey: credential.publicKey,
        counter: 0,
        transports: this.parseTransports(credential),
      },
    });
    if (!verified.verified) {
      throw walletError(400, 'ChallengeInvalid');
    }
    const revokedAt = await this.dataSource.transaction(async (manager) => {
      const fresh = await manager
        .createQueryBuilder(PasskeyCredential, 'credential')
        .setLock('pessimistic_write')
        .where('credential.id = :id', { id: credential.id })
        .andWhere('credential.wallet_account_id = :walletAccountId', { walletAccountId })
        .getOne();
      if (!fresh || fresh.walletAccountId !== walletAccountId) {
        throw walletError(404, 'PasskeyCredentialNotFound');
      }
      if (fresh.revokedAt) {
        throw walletError(401, 'PasskeyCredentialRevoked');
      }
      const stampedAt = this.currentTime();
      await this.deleteUsableChallenge(manager, challenge.id, stampedAt);
      await manager.update(PasskeyCredential, { id: credential.id }, { revokedAt: stampedAt });
      const account = await manager.update(WalletAccount, { id: walletAccountId }, { sessionValidAfter: stampedAt });
      if (!account.affected) {
        throw walletError(401, 'SessionInvalid');
      }
      return stampedAt;
    });
    return { revokedAt: revokedAt.toISOString() };
  }

  async listCredentials(walletAccountId: string) {
    const credentials = await this.credentials.find({
      where: { walletAccountId },
      order: { createdAt: 'DESC' },
    });
    return credentials.map((credential) => ({
      id: credential.credentialId,
      backupEligible: credential.backupEligible,
      backedUp: credential.backedUp,
      revokedAt: credential.revokedAt?.toISOString() ?? null,
      createdAt: credential.createdAt.toISOString(),
    }));
  }

  private async storeChallenge(
    challenge: string,
    purpose: 'register' | 'authenticate' | 'revoke',
    walletAccountId: string | null,
    id = randomUUID(),
  ): Promise<PasskeyChallenge> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1::bigint)', [CHALLENGE_ADVISORY_LOCK]);
      const now = new Date();
      const challenges = manager.withRepository(this.challenges);
      await challenges
        .createQueryBuilder()
        .delete()
        .from(PasskeyChallenge)
        .where('expires_at <= :now', { now })
        .execute();
      const live = await challenges
        .createQueryBuilder('challenge')
        .where('challenge.expires_at > :now', { now })
        .getCount();
      if (live >= MAX_LIVE_CHALLENGES) {
        throw walletError(429, 'ChallengeRateLimited');
      }
      const record = challenges.create({
        id,
        challenge,
        purpose,
        walletAccountId,
        expiresAt: new Date(now.getTime() + CHALLENGE_TTL_SECONDS * 1000),
        usedAt: null,
      });
      return challenges.save(record);
    });
  }

  private async findUsableChallenge(
    clientDataJSON: string | undefined,
    challengeId: unknown,
    purpose: 'register' | 'authenticate' | 'revoke',
  ): Promise<PasskeyChallenge> {
    let challengeFromClient: string | undefined;
    if (typeof clientDataJSON === 'string') {
      try {
        const parsed = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8')) as { challenge?: unknown };
        if (typeof parsed.challenge === 'string') {
          challengeFromClient = parsed.challenge;
        }
      } catch {
        throw walletError(400, 'ChallengeInvalid');
      }
    }
    let challenge: PasskeyChallenge | null = null;
    if (typeof challengeId === 'string' && UUID_PATTERN.test(challengeId)) {
      challenge = await this.challenges.findOneBy({ id: challengeId });
    }
    if (!challenge && challengeFromClient) {
      challenge = await this.challenges.findOneBy({ challenge: challengeFromClient });
      if (!challenge) {
        throw walletError(400, 'ChallengeInvalid');
      }
    }
    if (
      !challenge ||
      challenge.purpose !== purpose ||
      challenge.usedAt ||
      challenge.expiresAt.getTime() <= Date.now()
    ) {
      throw walletError(400, 'ChallengeInvalid');
    }
    if (challengeFromClient && challengeFromClient !== challenge.challenge) {
      throw walletError(400, 'ChallengeInvalid');
    }
    return challenge;
  }

  private parseTransports(credential: PasskeyCredential): any[] {
    try {
      const parsed = JSON.parse(credential.transports);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private currentTime(): Date {
    return new Date();
  }

  private async consumeChallenge(challengeId: string): Promise<void> {
    await this.deleteUsableChallenge(this.challenges, challengeId, new Date());
  }

  private async deleteUsableChallenge(
    manager: EntityManager | Repository<PasskeyChallenge>,
    challengeId: string,
    now: Date,
  ): Promise<void> {
    const result = await manager
      .createQueryBuilder()
      .delete()
      .from(PasskeyChallenge)
      .where('id = :id', { id: challengeId })
      .andWhere('used_at IS NULL')
      .andWhere('expires_at > :now', { now })
      .execute();
    if (!result.affected) {
      throw walletError(400, 'ChallengeInvalid');
    }
  }
}
