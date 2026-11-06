import { HttpException } from '@nestjs/common';

export type WalletErrorBody = {
  statusCode: number;
  code: string;
  message: string;
};

export function walletError(status: number, code: string): HttpException {
  const body: WalletErrorBody = { statusCode: status, code, message: code };
  return new HttpException(body, status);
}

export const WalletErrors = {
  passkeyNotConfigured: () => walletError(503, 'PasskeyNotConfigured'),
  challengeInvalid: () => walletError(400, 'ChallengeInvalid'),
  passkeyCredentialNotFound: () => walletError(404, 'PasskeyCredentialNotFound'),
  passkeyCredentialRevoked: () => walletError(401, 'PasskeyCredentialRevoked'),
  prfResultsRefused: () => walletError(400, 'PrfResultsRefused'),
  crossDeviceRegistration: () => walletError(400, 'CrossDeviceRegistration'),
  sessionRequired: () => walletError(401, 'SessionRequired'),
  sessionInvalid: () => walletError(401, 'SessionInvalid'),
  addressConflict: () => walletError(409, 'AddressConflict'),
  esploraNotConfigured: () => walletError(404, 'EsploraNotConfigured'),
  evmNotConfigured: () => walletError(404, 'EvmChainNotFound'),
  evmMethodNotAllowed: () => walletError(400, 'EvmMethodNotAllowed'),
  priceSourceNotConfigured: () => walletError(503, 'PriceSourceNotConfigured'),
  ensNotConfigured: () => walletError(503, 'EnsNotConfigured'),
  outboundRefused: () => walletError(400, 'OutboundUrlRefused'),
  outboundFailed: () => walletError(502, 'OutboundRequestFailed'),
  listNotFound: () => walletError(404, 'WalletListNotFound'),
  diagnosticInvalid: () => walletError(400, 'DiagnosticInvalid'),
  diagnosticTooLarge: () => walletError(413, 'DiagnosticTooLarge'),
  challengeRateLimited: () => walletError(429, 'ChallengeRateLimited'),
  diagnosticRateLimited: () => walletError(429, 'DiagnosticRateLimited'),
};
