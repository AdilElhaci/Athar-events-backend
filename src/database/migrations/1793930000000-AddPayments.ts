import { MigrationInterface, QueryRunner } from 'typeorm';

/** Moyasar payment attempts and webhook receipts (expand-only: two new tables, start empty). */
export class AddPayments1793930000000 implements MigrationInterface {
  name = 'AddPayments1793930000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "payment_attempt_status" AS ENUM('PENDING', 'PAID', 'FAILED', 'EXPIRED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "payment_attempts" ("id" uuid NOT NULL, "event_id" uuid NOT NULL, "owner_id" uuid NOT NULL, "amount" integer NOT NULL, "currency" character varying(3) NOT NULL, "status" "payment_attempt_status" NOT NULL DEFAULT 'PENDING', "moyasar_invoice_id" character varying(120), "moyasar_payment_id" character varying(120), "payment_url" character varying(500), "expires_at" TIMESTAMP WITH TIME ZONE, "failure_code" character varying(60), "failure_message" character varying(255), "paid_at" TIMESTAMP WITH TIME ZONE, "last_reconciled_at" TIMESTAMP WITH TIME ZONE, "metadata" jsonb NOT NULL DEFAULT '{}', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_payment_attempts" PRIMARY KEY ("id"), CONSTRAINT "FK_payment_attempts_event" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT, CONSTRAINT "FK_payment_attempts_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_payment_attempts_event_id" ON "payment_attempts" ("event_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_payment_attempts_status_created_at" ON "payment_attempts" ("status", "created_at")`,
    );
    // D-10: a second successful payment for the same event can never be applied.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_payment_attempts_event_paid" ON "payment_attempts" ("event_id") WHERE "status" = 'PAID'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_payment_attempts_moyasar_invoice_id" ON "payment_attempts" ("moyasar_invoice_id") WHERE "moyasar_invoice_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_payment_attempts_moyasar_payment_id" ON "payment_attempts" ("moyasar_payment_id") WHERE "moyasar_payment_id" IS NOT NULL`,
    );

    await queryRunner.query(
      `CREATE TYPE "webhook_provider" AS ENUM('MOYASAR', 'META')`,
    );
    await queryRunner.query(
      `CREATE TABLE "webhook_receipts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "provider" "webhook_provider" NOT NULL, "dedupe_key" character varying(200) NOT NULL, "received_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "processed_at" TIMESTAMP WITH TIME ZONE, "outcome" character varying(40), "error_code" character varying(60), CONSTRAINT "PK_webhook_receipts" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_webhook_receipts_provider_dedupe_key" ON "webhook_receipts" ("provider", "dedupe_key")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "webhook_receipts"`);
    await queryRunner.query(`DROP TYPE "webhook_provider"`);
    await queryRunner.query(`DROP TABLE "payment_attempts"`);
    await queryRunner.query(`DROP TYPE "payment_attempt_status"`);
  }
}
