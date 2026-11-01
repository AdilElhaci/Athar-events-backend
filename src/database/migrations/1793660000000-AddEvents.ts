import { MigrationInterface, QueryRunner } from 'typeorm';

/** Events with their package snapshot (expand-only: new types, sequence and table). */
export class AddEvents1793660000000 implements MigrationInterface {
  name = 'AddEvents1793660000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "event_status" AS ENUM('DRAFT', 'ACTIVE', 'CLOSED', 'CANCELLED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "event_payment_status" AS ENUM('UNPAID', 'PENDING', 'PAID', 'REFUNDED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "event_list_status" AS ENUM('AWAITING_LIST', 'IN_PROGRESS', 'READY')`,
    );
    await queryRunner.query(
      `CREATE TYPE "event_approval_status" AS ENUM('NOT_REQUESTED', 'AWAITING_OWNER', 'APPROVED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "event_campaign_status" AS ENUM('NOT_SCHEDULED', 'SCHEDULED', 'SENDING', 'PAUSED', 'SENT', 'CANCELLED')`,
    );
    await queryRunner.query(`CREATE SEQUENCE "events_reference_seq"`);
    await queryRunner.query(
      `CREATE TABLE "events" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "owner_id" uuid NOT NULL, "reference_code" character varying(16) NOT NULL DEFAULT 'AE-' || lpad(nextval('events_reference_seq')::text, 6, '0'), "name" character varying(120) NOT NULL, "starts_at" TIMESTAMP WITH TIME ZONE NOT NULL, "timezone" character varying(40) NOT NULL DEFAULT 'Asia/Riyadh', "venue_name" character varying(160) NOT NULL, "venue_map_url" character varying(500), "requested_send_at" TIMESTAMP WITH TIME ZONE, "package_id" uuid, "package_name" character varying(80) NOT NULL, "invitation_allowance" integer NOT NULL, "extra_margin" integer NOT NULL, "price_halalas" integer NOT NULL, "currency" character varying(3) NOT NULL, "status" "event_status" NOT NULL DEFAULT 'DRAFT', "payment_status" "event_payment_status" NOT NULL DEFAULT 'UNPAID', "list_status" "event_list_status" NOT NULL DEFAULT 'AWAITING_LIST', "approval_status" "event_approval_status" NOT NULL DEFAULT 'NOT_REQUESTED', "campaign_status" "event_campaign_status" NOT NULL DEFAULT 'NOT_SCHEDULED', "send_at" TIMESTAMP WITH TIME ZONE, "schedule_version" integer NOT NULL DEFAULT 0, "admission_opens_at" TIMESTAMP WITH TIME ZONE NOT NULL, "admission_closes_at" TIMESTAMP WITH TIME ZONE NOT NULL, "paid_at" TIMESTAMP WITH TIME ZONE, "cancelled_at" TIMESTAMP WITH TIME ZONE, "closed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_events_reference_code" UNIQUE ("reference_code"), CONSTRAINT "CHK_events_admission_window" CHECK ("admission_opens_at" < "admission_closes_at"), CONSTRAINT "CHK_events_requested_send_at" CHECK ("requested_send_at" IS NULL OR "requested_send_at" < "starts_at"), CONSTRAINT "CHK_events_send_at" CHECK ("send_at" IS NULL OR "send_at" < "starts_at"), CONSTRAINT "PK_events" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_events_owner_id" ON "events" ("owner_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "events" ADD CONSTRAINT "FK_events_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "events" ADD CONSTRAINT "FK_events_package" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER SEQUENCE "events_reference_seq" OWNED BY "events"."reference_code"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "events"`);
    await queryRunner.query(`DROP TYPE "event_campaign_status"`);
    await queryRunner.query(`DROP TYPE "event_approval_status"`);
    await queryRunner.query(`DROP TYPE "event_list_status"`);
    await queryRunner.query(`DROP TYPE "event_payment_status"`);
    await queryRunner.query(`DROP TYPE "event_status"`);
  }
}
