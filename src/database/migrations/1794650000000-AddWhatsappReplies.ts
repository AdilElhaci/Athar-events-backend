import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * D-44 admin replies to guests: one row per free-form WhatsApp text an admin sends inside the
 * 24 h customer-service window. `request_id` makes a double submit send once. Expand-only.
 */
export class AddWhatsappReplies1794650000000 implements MigrationInterface {
  name = 'AddWhatsappReplies1794650000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "whatsapp_replies" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "event_id" uuid NOT NULL, "guest_id" uuid NOT NULL, "sent_by_user_id" uuid NOT NULL, "request_id" uuid NOT NULL, "to_phone" character varying(16) NOT NULL, "body" text NOT NULL, "state" "whatsapp_message_state" NOT NULL DEFAULT 'SENDING', "delivery_status" "whatsapp_delivery_status" NOT NULL DEFAULT 'NONE', "provider_message_id" character varying(128), "error_code" character varying(60), "sent_at" TIMESTAMP WITH TIME ZONE, "delivered_at" TIMESTAMP WITH TIME ZONE, "read_at" TIMESTAMP WITH TIME ZONE, "failed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_whatsapp_replies" PRIMARY KEY ("id"), CONSTRAINT "UQ_whatsapp_replies_request_id" UNIQUE ("request_id"), CONSTRAINT "FK_whatsapp_replies_event" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT, CONSTRAINT "FK_whatsapp_replies_guest" FOREIGN KEY ("guest_id") REFERENCES "guests"("id") ON DELETE RESTRICT, CONSTRAINT "FK_whatsapp_replies_sent_by" FOREIGN KEY ("sent_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT, CONSTRAINT "CHK_whatsapp_replies_body_length" CHECK (char_length("body") BETWEEN 1 AND 4096), CONSTRAINT "CHK_whatsapp_replies_state" CHECK ("state" IN ('SENDING', 'SENT', 'FAILED', 'UNKNOWN')))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_whatsapp_replies_provider_message_id" ON "whatsapp_replies" ("provider_message_id") WHERE "provider_message_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_whatsapp_replies_event_created" ON "whatsapp_replies" ("event_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_whatsapp_inbound_from_received" ON "whatsapp_inbound" ("from_phone", "received_at" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_whatsapp_inbound_from_received"`);
    await queryRunner.query(`DROP TABLE "whatsapp_replies"`);
  }
}
