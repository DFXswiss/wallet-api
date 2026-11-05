import { MigrationInterface, QueryRunner } from 'typeorm';

export class WalletSchema1740000000000 implements MigrationInterface {
  name = 'WalletSchema1740000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "wallet_account" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_wallet_account" PRIMARY KEY ("id")
    )`);

    await queryRunner.query(`CREATE TABLE "passkey_credential" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "wallet_account_id" uuid NOT NULL,
      "credential_id" text NOT NULL,
      "public_key" text NOT NULL,
      "user_handle" text NOT NULL,
      "backup_eligible" boolean NOT NULL DEFAULT false,
      "backed_up" boolean NOT NULL DEFAULT false,
      "aaguid" text NULL,
      "transports" text NOT NULL DEFAULT '[]',
      "revoked_at" timestamptz NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_passkey_credential" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_passkey_credential_credential_id" UNIQUE ("credential_id"),
      CONSTRAINT "FK_passkey_credential_wallet_account" FOREIGN KEY ("wallet_account_id")
        REFERENCES "wallet_account"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_passkey_credential_wallet_account" ON "passkey_credential" ("wallet_account_id")`,
    );

    await queryRunner.query(`CREATE TABLE "passkey_challenge" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "wallet_account_id" uuid NULL,
      "challenge" text NOT NULL,
      "purpose" text NOT NULL,
      "expires_at" timestamptz NOT NULL,
      "used_at" timestamptz NULL,
      CONSTRAINT "PK_passkey_challenge" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_passkey_challenge_challenge" UNIQUE ("challenge"),
      CONSTRAINT "FK_passkey_challenge_wallet_account" FOREIGN KEY ("wallet_account_id")
        REFERENCES "wallet_account"("id") ON DELETE SET NULL
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_passkey_challenge_wallet_account" ON "passkey_challenge" ("wallet_account_id")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_passkey_challenge_expires" ON "passkey_challenge" ("expires_at")`);

    await queryRunner.query(`CREATE TABLE "passkey_address" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "wallet_account_id" uuid NOT NULL,
      "chain" text NOT NULL,
      "address" text NOT NULL,
      CONSTRAINT "PK_passkey_address" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_passkey_address_account_chain" UNIQUE ("wallet_account_id", "chain"),
      CONSTRAINT "FK_passkey_address_wallet_account" FOREIGN KEY ("wallet_account_id")
        REFERENCES "wallet_account"("id") ON DELETE CASCADE
    )`);

    await queryRunner.query(`CREATE TABLE "passkey_diagnostic" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "wallet_account_id" uuid NULL,
      "payload" jsonb NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_passkey_diagnostic" PRIMARY KEY ("id"),
      CONSTRAINT "FK_passkey_diagnostic_wallet_account" FOREIGN KEY ("wallet_account_id")
        REFERENCES "wallet_account"("id") ON DELETE SET NULL
    )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "passkey_diagnostic"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "passkey_address"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "passkey_challenge"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "passkey_credential"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "wallet_account"`);
  }
}
