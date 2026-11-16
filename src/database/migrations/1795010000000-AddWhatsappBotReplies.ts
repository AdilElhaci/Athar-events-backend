import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * D-49 WhatsApp auto-reply menu: the bot's answers are kept with the admins' replies so the inbox
 * shows the whole conversation. A reply is either an admin's (`ADMIN`, with its author) or the
 * bot's (`BOT`, no author); the check constraint keeps the two consistent. Expand-only.
 */
export class AddWhatsappBotReplies1795010000000 implements MigrationInterface {
  name = 'AddWhatsappBotReplies1795010000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "whatsapp_reply_source" AS ENUM ('ADMIN', 'BOT')`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_replies" ADD "source" "whatsapp_reply_source" NOT NULL DEFAULT 'ADMIN'`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_replies" ALTER COLUMN "sent_by_user_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_replies" ADD CONSTRAINT "CHK_whatsapp_replies_source_author" CHECK (("source" = 'ADMIN') = ("sent_by_user_id" IS NOT NULL))`,
    );
    // The bot stays silent for a while after an admin answered the number.
    await queryRunner.query(
      `CREATE INDEX "IDX_whatsapp_replies_admin_to_created" ON "whatsapp_replies" ("to_phone", "created_at" DESC) WHERE "source" = 'ADMIN'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_whatsapp_replies_admin_to_created"`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_replies" DROP CONSTRAINT "CHK_whatsapp_replies_source_author"`,
    );
    await queryRunner.query(
      `DELETE FROM "whatsapp_replies" WHERE "source" = 'BOT'`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_replies" ALTER COLUMN "sent_by_user_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_replies" DROP COLUMN "source"`,
    );
    await queryRunner.query(`DROP TYPE "whatsapp_reply_source"`);
  }
}
