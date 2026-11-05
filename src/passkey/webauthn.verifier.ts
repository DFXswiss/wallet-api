import { Injectable } from '@nestjs/common';
import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { walletError } from '../common/wallet-error';

export const WEBAUTHN_VERIFIER = Symbol('WEBAUTHN_VERIFIER');

export type RegistrationVerificationInput = {
  response: RegistrationResponseJSON;
  expectedChallenge: string;
  expectedOrigin: string;
  expectedRPID: string;
};

export type RegistrationVerificationResult = {
  verified: boolean;
  credentialId: string;
  publicKey: string;
  counter: number;
  backupEligible: boolean;
  backedUp: boolean;
  aaguid?: string;
  transports?: string[];
};

export type AuthenticationVerificationInput = {
  response: AuthenticationResponseJSON;
  expectedChallenge: string;
  expectedOrigin: string;
  expectedRPID: string;
  credential: {
    id: string;
    publicKey: string;
    counter: number;
    transports?: string[];
  };
};

export type AuthenticationVerificationResult = {
  verified: boolean;
};

export interface WebAuthnVerifier {
  verifyRegistration(input: RegistrationVerificationInput): Promise<RegistrationVerificationResult>;
  verifyAuthentication(input: AuthenticationVerificationInput): Promise<AuthenticationVerificationResult>;
}

export type PasskeyResponseLike = {
  clientExtensionResults?: { prf?: { results?: Record<string, unknown> } };
  authenticatorAttachment?: string;
  response?: { authenticatorAttachment?: string; clientDataJSON?: string };
};

export function hasPrfResults(response: PasskeyResponseLike | undefined): boolean {
  return response?.clientExtensionResults?.prf?.results !== undefined;
}

export function readAuthenticatorAttachment(response: PasskeyResponseLike | undefined): string | undefined {
  return response?.authenticatorAttachment ?? response?.response?.authenticatorAttachment;
}

@Injectable()
export class SimpleWebAuthnVerifier implements WebAuthnVerifier {
  async verifyRegistration(input: RegistrationVerificationInput): Promise<RegistrationVerificationResult> {
    let result;
    try {
      result = await verifyRegistrationResponse({
        response: input.response,
        expectedChallenge: input.expectedChallenge,
        expectedOrigin: input.expectedOrigin,
        expectedRPID: input.expectedRPID,
        requireUserVerification: true,
        supportedAlgorithmIDs: [-7, -257],
      });
    } catch {
      throw walletError(400, 'ChallengeInvalid');
    }
    if (!result.verified || !result.registrationInfo) {
      throw walletError(400, 'ChallengeInvalid');
    }
    const info = result.registrationInfo;
    return {
      verified: true,
      credentialId: info.credential.id,
      publicKey: Buffer.from(info.credential.publicKey).toString('base64url'),
      counter: 0,
      backupEligible: info.credentialDeviceType === 'multiDevice',
      backedUp: info.credentialBackedUp,
      aaguid: info.aaguid,
      transports: (info.credential.transports as string[] | undefined) ?? [],
    };
  }

  async verifyAuthentication(input: AuthenticationVerificationInput): Promise<AuthenticationVerificationResult> {
    const credential = {
      id: input.credential.id,
      publicKey: Buffer.from(input.credential.publicKey, 'base64url'),
      // Synced passkeys report 0. A stored counter would lock out the other device.
      counter: 0,
      transports: input.credential.transports as any,
    };
    let result;
    try {
      result = await verifyAuthenticationResponse({
        response: input.response,
        expectedChallenge: input.expectedChallenge,
        expectedOrigin: input.expectedOrigin,
        expectedRPID: input.expectedRPID,
        credential,
        requireUserVerification: true,
      });
    } catch {
      throw walletError(400, 'ChallengeInvalid');
    }
    if (!result.verified) {
      throw walletError(400, 'ChallengeInvalid');
    }
    return { verified: true };
  }
}
