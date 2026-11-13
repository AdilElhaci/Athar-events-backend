import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * D-43 guest replies inbox: inbound messages keep their text and the event they belong to, so
 * admins can read what guests wrote. Expand-only; existing rows get their event from the guest.
 */
export class AddInboundReplies1794560000000 implements MigrationInterface {
  name = 'AddInboundReplies1794560000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "whatsapp_inbound" ADD "event_id" uuid`,
    );
    await queryRunner.query(`ALTER TABLE "whatsapp_inbound" ADD "body" text`);
    await queryRunner.query(
      `ALTER TABLE "whatsapp_inbound" ADD "meta_type" character varying(20)`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_inbound" ADD CONSTRAINT "FK_whatsapp_inbound_event" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_inbound" ADD CONSTRAINT "CHK_whatsapp_inbound_body_length" CHECK ("body" IS NULL OR char_length("body") <= 4096)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_whatsapp_inbound_event_received" ON "whatsapp_inbound" ("event_id", "received_at" DESC)`,
    );
    await queryRunner.query(
      `UPDATE "whatsapp_inbound" i SET "event_id" = g."event_id" FROM "guests" g WHERE g."id" = i."guest_id"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_whatsapp_inbound_event_received"`);
    await queryRunner.query(
      `ALTER TABLE "whatsapp_inbound" DROP CONSTRAINT "CHK_whatsapp_inbound_body_length"`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_inbound" DROP CONSTRAINT "FK_whatsapp_inbound_event"`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_inbound" DROP COLUMN "meta_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_inbound" DROP COLUMN "body"`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_inbound" DROP COLUMN "event_id"`,
    );
  }
}
