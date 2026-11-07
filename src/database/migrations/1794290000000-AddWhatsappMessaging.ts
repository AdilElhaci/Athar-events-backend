import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Outbound WhatsApp intents, inbound button replies and the guest QR/RSVP columns (SP-04, SP-05,
 * data-model.md). Expand-only. The delivery enum is declared in rank order so a monotonic update
 * can compare with `<` (FAILED is last and handled apart).
 */
export class AddWhatsappMessaging1794290000000 implements MigrationInterface {
  name = 'AddWhatsappMessaging1794290000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "guests" ADD "rsvp_locked" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "guests" ADD "qr_token_hash" character varying(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "guests" ADD "qr_version" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "guests" ADD "qr_issued_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "guests" ADD "checked_in_by_user_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "guests" ADD CONSTRAINT "FK_guests_checked_in_by" FOREIGN KEY ("checked_in_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_guests_qr_token_hash" ON "guests" ("qr_token_hash") WHERE "qr_token_hash" IS NOT NULL`,
    );

    await queryRunner.query(
      `CREATE TYPE "whatsapp_message_kind" AS ENUM('INVITATION', 'QR', 'QR_TEMPLATE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "whatsapp_message_state" AS ENUM('QUEUED', 'SENDING', 'SENT', 'FAILED', 'UNKNOWN', 'CANCELLED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "whatsapp_delivery_status" AS ENUM('NONE', 'SENT', 'DELIVERED', 'READ', 'FAILED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "whatsapp_messages" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "event_id" uuid NOT NULL, "guest_id" uuid NOT NULL, "kind" "whatsapp_message_kind" NOT NULL, "logical_key" character varying(120) NOT NULL, "schedule_version" integer NOT NULL DEFAULT 0, "qr_version" integer, "state" "whatsapp_message_state" NOT NULL DEFAULT 'QUEUED', "delivery_status" "whatsapp_delivery_status" NOT NULL DEFAULT 'NONE', "provider_message_id" character varying(128), "claimed_at" TIMESTAMP WITH TIME ZONE, "attempt_count" smallint NOT NULL DEFAULT 0, "last_error_code" character varying(60), "sent_at" TIMESTAMP WITH TIME ZONE, "delivered_at" TIMESTAMP WITH TIME ZONE, "read_at" TIMESTAMP WITH TIME ZONE, "failed_at" TIMESTAMP WITH TIME ZONE, "resolved_by_user_id" uuid, "resolved_at" TIMESTAMP WITH TIME ZONE, "resolution" character varying(20), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_whatsapp_messages" PRIMARY KEY ("id"), CONSTRAINT "FK_whatsapp_messages_event" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT, CONSTRAINT "FK_whatsapp_messages_guest" FOREIGN KEY ("guest_id") REFERENCES "guests"("id") ON DELETE RESTRICT, CONSTRAINT "CHK_whatsapp_messages_qr_version" CHECK ("kind" = 'INVITATION' OR "qr_version" IS NOT NULL))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_whatsapp_messages_logical_key" ON "whatsapp_messages" ("logical_key")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_whatsapp_messages_provider_message_id" ON "whatsapp_messages" ("provider_message_id") WHERE "provider_message_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_whatsapp_messages_guest_id" ON "whatsapp_messages" ("guest_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_whatsapp_messages_open" ON "whatsapp_messages" ("state", "created_at") WHERE "state" IN ('QUEUED', 'SENDING')`,
    );

    await queryRunner.query(
      `CREATE TYPE "whatsapp_inbound_type" AS ENUM('BUTTON', 'TEXT', 'OTHER')`,
    );
    await queryRunner.query(
      `CREATE TYPE "whatsapp_inbound_outcome" AS ENUM('APPLIED', 'UNMATCHED', 'LOCKED', 'DUPLICATE', 'AFTER_EVENT', 'IGNORED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "whatsapp_inbound" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "provider_message_id" character varying(128) NOT NULL, "context_message_id" character varying(128), "from_phone" character varying(16), "type" "whatsapp_inbound_type" NOT NULL, "button_payload" character varying(64), "guest_id" uuid, "outcome" "whatsapp_inbound_outcome" NOT NULL, "received_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_whatsapp_inbound" PRIMARY KEY ("id"), CONSTRAINT "FK_whatsapp_inbound_guest" FOREIGN KEY ("guest_id") REFERENCES "guests"("id") ON DELETE SET NULL)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_whatsapp_inbound_provider_message_id" ON "whatsapp_inbound" ("provider_message_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "whatsapp_inbound"`);
    await queryRunner.query(`DROP TYPE "whatsapp_inbound_outcome"`);
    await queryRunner.query(`DROP TYPE "whatsapp_inbound_type"`);
    await queryRunner.query(`DROP TABLE "whatsapp_messages"`);
    await queryRunner.query(`DROP TYPE "whatsapp_delivery_status"`);
    await queryRunner.query(`DROP TYPE "whatsapp_message_state"`);
    await queryRunner.query(`DROP TYPE "whatsapp_message_kind"`);
    await queryRunner.query(`DROP INDEX "UQ_guests_qr_token_hash"`);
    await queryRunner.query(
      `ALTER TABLE "guests" DROP CONSTRAINT "FK_guests_checked_in_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "guests" DROP COLUMN "checked_in_by_user_id"`,
    );
    await queryRunner.query(`ALTER TABLE "guests" DROP COLUMN "qr_issued_at"`);
    await queryRunner.query(`ALTER TABLE "guests" DROP COLUMN "qr_version"`);
    await queryRunner.query(`ALTER TABLE "guests" DROP COLUMN "qr_token_hash"`);
    await queryRunner.query(`ALTER TABLE "guests" DROP COLUMN "rsvp_locked"`);
  }
}
