import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * D-45 WhatsApp inbox: conversations are per phone number, not per event. A guest message is
 * unread until an admin opens the conversation (`seen_at`; RSVP buttons never count). A reply
 * may go to a number that is no guest, so its event and guest become optional. Messages received
 * before the inbox existed are marked seen. Expand-only.
 */
export class AddWhatsappInbox1794740000000 implements MigrationInterface {
  name = 'AddWhatsappInbox1794740000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "whatsapp_inbound" ADD "seen_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `UPDATE "whatsapp_inbound" SET "seen_at" = "received_at"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_whatsapp_inbound_unseen" ON "whatsapp_inbound" ("from_phone") WHERE "seen_at" IS NULL AND "type" <> 'BUTTON'`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_replies" ALTER COLUMN "event_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_replies" ALTER COLUMN "guest_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_whatsapp_replies_to_created" ON "whatsapp_replies" ("to_phone", "created_at" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_whatsapp_replies_to_created"`);
    await queryRunner.query(
      `DELETE FROM "whatsapp_replies" WHERE "event_id" IS NULL OR "guest_id" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_replies" ALTER COLUMN "guest_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_replies" ALTER COLUMN "event_id" SET NOT NULL`,
    );
    await queryRunner.query(`DROP INDEX "IDX_whatsapp_inbound_unseen"`);
    await queryRunner.query(
      `ALTER TABLE "whatsapp_inbound" DROP COLUMN "seen_at"`,
    );
  }
}
