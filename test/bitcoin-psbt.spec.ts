import * as btc from '@scure/btc-signer';
import { REGTEST_PARAMS, decodeWalletAddress, BITCOIN_NETWORKS } from '../src/bitcoin/bitcoin-network';
import {
  FINAL_SEQUENCE,
  PsbtInput,
  PsbtOutput,
  RBF_SEQUENCE,
  buildUnsignedPayment,
  serializeWithoutWitness,
  unsignedTxid,
} from '../src/bitcoin/psbt-builder';
import {
  extractFromPsbt,
  isSignedP2wpkh,
  outpointKey,
  parseRawTransaction,
  parseTransactionHex,
} from '../src/bitcoin/raw-transaction';
import { p2wpkh, privateKey, publicKey, txid, walletCode } from './bitcoin-fixtures';

const regtest = BITCOIN_NETWORKS.BitcoinRegtest;

function script(seed: number): Uint8Array {
  return decodeWalletAddress(regtest, p2wpkh(seed, REGTEST_PARAMS)).script;
}

const inputs: PsbtInput[] = [
  { txid: txid('a'), vout: 1, value: 60_000, script: script(1) },
  { txid: txid('b'), vout: 0, value: 40_000, script: script(2) },
];

const outputs: PsbtOutput[] = [
  { value: 70_000, script: script(3) },
  { value: 29_791, script: script(2) },
];

const prevoutScripts = new Map(inputs.map((input) => [outpointKey(input.txid, input.vout), input.script]));

/** Re-serializes `raw` with the witness stacks `witnesses` (one per input). */
function withWitnesses(raw: Buffer, witnesses: Buffer[][]): Buffer {
  const unsigned = serializeWithoutWitness(inputs, outputs, RBF_SEQUENCE);
  expect(parseRawTransaction(raw).txid).toBe(parseRawTransaction(unsigned).txid);
  // Every count and length here is below 0xfd, so each varint is one byte.
  const item = (bytes: Buffer) => Buffer.concat([Buffer.from([bytes.length]), bytes]);
  const stacks = witnesses.map((stack) => Buffer.concat([Buffer.from([stack.length]), ...stack.map(item)]));
  return Buffer.concat([
    unsigned.subarray(0, 4),
    Buffer.from([0x00, 0x01]),
    unsigned.subarray(4, unsigned.length - 4),
    ...stacks,
    unsigned.subarray(unsigned.length - 4),
  ]);
}

function signAll(psbt: string, finalize = true): btc.Transaction {
  const tx = btc.Transaction.fromPSBT(new Uint8Array(Buffer.from(psbt, 'base64')));
  tx.signIdx(privateKey(1), 0);
  tx.signIdx(privateKey(2), 1);
  if (finalize) {
    tx.finalize();
  }
  return tx;
}

describe('unsigned PSBT', () => {
  it('carries witnessUtxo, the sequence, and the outputs', () => {
    const { psbt } = buildUnsignedPayment(inputs, outputs, RBF_SEQUENCE);
    const tx = btc.Transaction.fromPSBT(new Uint8Array(Buffer.from(psbt, 'base64')));
    expect(tx.inputsLength).toBe(2);
    expect(tx.outputsLength).toBe(2);
    const first = tx.getInput(0);
    expect(Buffer.from(first.txid as Uint8Array).toString('hex')).toBe(txid('a'));
    expect(first.index).toBe(1);
    expect(first.sequence).toBe(RBF_SEQUENCE);
    expect(first.witnessUtxo?.amount).toBe(60_000n);
    expect(Buffer.from(first.witnessUtxo?.script as Uint8Array).equals(Buffer.from(script(1)))).toBe(true);
    expect(first.bip32Derivation ?? []).toHaveLength(0);
    expect(tx.getOutput(0).amount).toBe(70_000n);
    expect(tx.getOutput(1).amount).toBe(29_791n);
  });

  it('has the txid of the signed transaction', () => {
    const unsigned = buildUnsignedPayment(inputs, outputs, RBF_SEQUENCE);
    const signed = signAll(unsigned.psbt);
    const parsed = parseRawTransaction(Buffer.from(signed.extract()));
    expect(parsed.txid).toBe(unsigned.txid);
    expect(signed.id).toBe(unsigned.txid);
    expect(parsed.segwit).toBe(true);
    expect(isSignedP2wpkh(parsed, prevoutScripts)).toBe(true);
    expect(parsed.inputs.map((input) => input.sequence)).toEqual([RBF_SEQUENCE, RBF_SEQUENCE]);
  });

  it('changes the txid with the sequence', () => {
    expect(unsignedTxid(inputs, outputs, RBF_SEQUENCE)).not.toBe(unsignedTxid(inputs, outputs, FINAL_SEQUENCE));
    const signed = signAll(buildUnsignedPayment(inputs, outputs, FINAL_SEQUENCE).psbt);
    expect(parseRawTransaction(Buffer.from(signed.extract())).inputs[0].sequence).toBe(FINAL_SEQUENCE);
  });
});

describe('raw transaction parser', () => {
  it('round-trips the serialization without witness', () => {
    const raw = serializeWithoutWitness(inputs, outputs, RBF_SEQUENCE);
    const parsed = parseRawTransaction(raw);
    expect(parsed).toMatchObject({ version: 2, locktime: 0, segwit: false });
    expect(parsed.txid).toBe(unsignedTxid(inputs, outputs, RBF_SEQUENCE));
    expect(parsed.inputs.map((input) => [input.txid, input.vout])).toEqual([
      [txid('a'), 1],
      [txid('b'), 0],
    ]);
    expect(parsed.outputs.map((output) => output.value)).toEqual([70_000n, 29_791n]);
    expect(isSignedP2wpkh(parsed, prevoutScripts)).toBe(false);
  });

  it('refuses truncated, padded, and empty bytes', () => {
    const raw = serializeWithoutWitness(inputs, outputs, RBF_SEQUENCE);
    for (const bytes of [Buffer.alloc(0), raw.subarray(0, raw.length - 1), Buffer.concat([raw, Buffer.from([0])])]) {
      expect(walletCode(() => parseRawTransaction(bytes))).toEqual({ status: 400, code: 'TransactionInvalid' });
    }
  });

  it('refuses a transaction without inputs or outputs', () => {
    const noInputs = Buffer.from('02000000000100000000', 'hex');
    expect(walletCode(() => parseRawTransaction(noInputs))).toEqual({ status: 400, code: 'TransactionInvalid' });
    const noOutputs = serializeWithoutWitness(inputs, [], RBF_SEQUENCE);
    expect(walletCode(() => parseRawTransaction(noOutputs))).toEqual({ status: 400, code: 'TransactionInvalid' });
  });

  it('refuses hex that is not hex', () => {
    for (const hex of ['', 'abc', 'zz', '0x00']) {
      expect(walletCode(() => parseTransactionHex(hex))).toEqual({ status: 400, code: 'TransactionInvalid' });
    }
    expect(parseTransactionHex('00FF').equals(Buffer.from([0, 255]))).toBe(true);
  });
});

describe('P2WPKH signature shape', () => {
  const signed = () => {
    const raw = Buffer.from(signAll(buildUnsignedPayment(inputs, outputs, RBF_SEQUENCE).psbt).extract());
    return { raw, witnesses: parseRawTransaction(raw).inputs.map((input) => input.witness) };
  };
  const check = (raw: Buffer, scripts: ReadonlyMap<string, Uint8Array> = prevoutScripts) =>
    isSignedP2wpkh(parseRawTransaction(raw), scripts);

  it('accepts the device-signed transaction and its re-serialization', () => {
    const { raw, witnesses } = signed();
    expect(check(raw)).toBe(true);
    expect(withWitnesses(raw, witnesses).equals(raw)).toBe(true);
  });

  it('refuses an empty or oversized signature item', () => {
    const { raw, witnesses } = signed();
    for (const signature of [Buffer.alloc(0), Buffer.alloc(74, 0x30)]) {
      expect(check(withWitnesses(raw, [[signature, witnesses[0][1]], witnesses[1]]))).toBe(false);
    }
    expect(check(withWitnesses(raw, [[Buffer.alloc(73, 0x30), witnesses[0][1]], witnesses[1]]))).toBe(true);
  });

  it('refuses a witness that is not two items, and an input without witness', () => {
    const { raw, witnesses } = signed();
    expect(check(withWitnesses(raw, [[witnesses[0][1]], witnesses[1]]))).toBe(false);
    expect(check(withWitnesses(raw, [[...witnesses[0], Buffer.from([1])], witnesses[1]]))).toBe(false);
    expect(check(withWitnesses(raw, [[], witnesses[1]]))).toBe(false);
  });

  it('refuses a public key that is not the prepared input key or not compressed', () => {
    const { raw, witnesses } = signed();
    const other = Buffer.from(publicKey(3));
    expect(check(withWitnesses(raw, [[witnesses[0][0], other], witnesses[1]]))).toBe(false);
    // Swapped keys: each is a valid wallet key, but not the key of the input it signs.
    expect(
      check(
        withWitnesses(raw, [
          [witnesses[0][0], witnesses[1][1]],
          [witnesses[1][0], witnesses[0][1]],
        ]),
      ),
    ).toBe(false);
    const badPrefix = Buffer.from(witnesses[0][1]);
    badPrefix[0] = 0x04;
    expect(check(withWitnesses(raw, [[witnesses[0][0], badPrefix], witnesses[1]]))).toBe(false);
  });

  it('refuses when the prepared inputs do not cover every input', () => {
    const { raw } = signed();
    const partial = new Map([...prevoutScripts].slice(0, 1));
    expect(check(raw, partial)).toBe(false);
    expect(check(raw, new Map())).toBe(false);
  });
});

describe('PSBT extraction', () => {
  it('finalizes a signed PSBT', () => {
    const unsigned = buildUnsignedPayment(inputs, outputs, RBF_SEQUENCE);
    const signed = signAll(unsigned.psbt, false);
    const raw = extractFromPsbt(Buffer.from(signed.toPSBT()).toString('base64'));
    expect(parseRawTransaction(raw).txid).toBe(unsigned.txid);
  });

  it('refuses an unsigned PSBT', () => {
    const unsigned = buildUnsignedPayment(inputs, outputs, RBF_SEQUENCE);
    expect(walletCode(() => extractFromPsbt(unsigned.psbt))).toEqual({ status: 400, code: 'TransactionNotSigned' });
  });

  it('refuses a PSBT that does not decode', () => {
    expect(walletCode(() => extractFromPsbt('cHNidP8='))).toEqual({ status: 400, code: 'TransactionInvalid' });
    expect(walletCode(() => extractFromPsbt('not base64!'))).toEqual({ status: 400, code: 'TransactionInvalid' });
  });
});
