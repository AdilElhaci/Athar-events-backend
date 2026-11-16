import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * D-47 inbox add-on: media in and out, locations and contacts, and template sends.
 * - `whatsapp_inbound.details`: structured content of a location, contacts card or reaction.
 * - `whatsapp_replies.message_type` (`text`, `image`, `document`, `template`) and the template
 *   sent; `body` becomes optional (an image without a caption).
 * - `whatsapp_media`: one stored copy per message, because Meta's media links expire. Bytes live in
 *   PostgreSQL like article covers, so they follow blue/green deploys and database backups, and go
 *   with their message (ON DELETE CASCADE) when retention deletes it.
 * Expand-only.
 */
export class AddInboxMedia1794830000000 implements MigrationInterface {
  name = 'AddInboxMedia1794830000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "whatsapp_inbound" ADD "details" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_replies" ADD "message_type" character varying(20) NOT NULL DEFAULT 'text'`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_replies" ADD "template_name" character varying(512)`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_replies" ADD "template_language" character varying(15)`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_replies" ADD "template_category" character varying(20)`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_replies" ADD CONSTRAINT "CHK_whatsapp_replies_message_type" CHECK ("message_type" IN ('text', 'image', 'document', 'template'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_replies" ALTER COLUMN "body" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_replies" DROP CONSTRAINT "CHK_whatsapp_replies_body_length"`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_replies" ADD CONSTRAINT "CHK_whatsapp_replies_body_length" CHECK ("body" IS NULL OR char_length("body") BETWEEN 1 AND 4096)`,
    );
    await queryRunner.query(
      `CREATE TYPE "whatsapp_media_state" AS ENUM ('PENDING', 'STORED', 'FAILED', 'TOO_LARGE')`,
    );
    await queryRunner.query(
      `CREATE TABLE "whatsapp_media" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "inbound_id" uuid, "reply_id" uuid, "meta_media_id" character varying(128), "mime_type" character varying(100) NOT NULL, "file_name" character varying(255), "size_bytes" integer, "data" bytea, "state" "whatsapp_media_state" NOT NULL DEFAULT 'PENDING', "attempts" smallint NOT NULL DEFAULT 0, "claimed_at" TIMESTAMP WITH TIME ZONE, "error_code" character varying(60), "stored_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_whatsapp_media" PRIMARY KEY ("id"), CONSTRAINT "FK_whatsapp_media_inbound" FOREIGN KEY ("inbound_id") REFERENCES "whatsapp_inbound"("id") ON DELETE CASCADE, CONSTRAINT "FK_whatsapp_media_reply" FOREIGN KEY ("reply_id") REFERENCES "whatsapp_replies"("id") ON DELETE CASCADE, CONSTRAINT "CHK_whatsapp_media_owner" CHECK (("inbound_id" IS NULL) <> ("reply_id" IS NULL)), CONSTRAINT "CHK_whatsapp_media_stored" CHECK ("state" <> 'STORED' OR "data" IS NOT NULL))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_whatsapp_media_inbound" ON "whatsapp_media" ("inbound_id") WHERE "inbound_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_whatsapp_media_reply" ON "whatsapp_media" ("reply_id") WHERE "reply_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_whatsapp_media_pending" ON "whatsapp_media" ("created_at") WHERE "state" = 'PENDING'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "whatsapp_media"`);
    await queryRunner.query(`DROP TYPE "whatsapp_media_state"`);
    await queryRunner.query(
      `DELETE FROM "whatsapp_replies" WHERE "body" IS NULL OR "message_type" <> 'text'`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_replies" DROP CONSTRAINT "CHK_whatsapp_replies_body_length"`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_replies" ADD CONSTRAINT "CHK_whatsapp_replies_body_length" CHECK (char_length("body") BETWEEN 1 AND 4096)`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_replies" ALTER COLUMN "body" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_replies" DROP CONSTRAINT "CHK_whatsapp_replies_message_type"`,
    );
    for (const column of [
      'template_category',
      'template_language',
      'template_name',
      'message_type',
    ])
      await queryRunner.query(
        `ALTER TABLE "whatsapp_replies" DROP COLUMN "${column}"`,
      );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_inbound" DROP COLUMN "details"`,
    );
  }
}
