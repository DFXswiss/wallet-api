import { MigrationInterface, QueryRunner } from 'typeorm';

export class BitcoinPreparedPayment1795824000000 implements MigrationInterface {
  name = 'BitcoinPreparedPayment1795824000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "bitcoin_prepared_payment" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "wallet_account_id" uuid NOT NULL,
      "blockchain" text NOT NULL,
      "txid" text NOT NULL,
      "psbt" text NOT NULL,
      "inputs" jsonb NOT NULL,
      "outputs" jsonb NOT NULL,
      "amount" bigint NOT NULL,
      "fee" bigint NOT NULL,
      "fee_rate" integer NOT NULL,
      "expires_at" timestamptz NOT NULL,
      "submitted_at" timestamptz NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_bitcoin_prepared_payment" PRIMARY KEY ("id"),
      CONSTRAINT "CHK_bitcoin_prepared_payment_txid" CHECK ("txid" ~ '^[0-9a-f]{64}$'),
      CONSTRAINT "CHK_bitcoin_prepared_payment_amounts" CHECK ("amount" > 0 AND "fee" > 0 AND "fee_rate" > 0),
      CONSTRAINT "FK_bitcoin_prepared_payment_wallet_account" FOREIGN KEY ("wallet_account_id")
        REFERENCES "wallet_account"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_bitcoin_prepared_payment_wallet_account" ON "bitcoin_prepared_payment" ("wallet_account_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bitcoin_prepared_payment_expires" ON "bitcoin_prepared_payment" ("expires_at")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "bitcoin_prepared_payment"`);
  }
}
