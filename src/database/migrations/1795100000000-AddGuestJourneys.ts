import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * SP-07 guest journeys (D-50…D-55): the event's journey, RSVP close and contact-permission
 * declaration; the journey message kinds and their due time; late replies waiting for an admin
 * (`REVIEW`); a replaced guest's accept that used a vacant invitation. Expand-only: new enum
 * values and nullable columns.
 */
export class AddGuestJourneys1795100000000 implements MigrationInterface {
  name = 'AddGuestJourneys1795100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "events" ADD "journey" smallint`);
    await queryRunner.query(
      `ALTER TABLE "events" ADD CONSTRAINT "CHK_events_journey" CHECK ("journey" IS NULL OR "journey" IN (7, 21, 40))`,
    );
    await queryRunner.query(
      `ALTER TABLE "events" ADD "rsvp_closes_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "events" ADD CONSTRAINT "CHK_events_rsvp_closes_at" CHECK ("rsvp_closes_at" IS NULL OR "rsvp_closes_at" < "starts_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "events" ADD "contact_consent_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "events" ADD "contact_consent_by_user_id" uuid`,
    );

    for (const kind of [
      'FOLLOW_UP_1',
      'FOLLOW_UP_2',
      'REMINDER_1',
      'REMINDER_FINAL',
      'THANK_YOU',
      'APOLOGY',
    ])
      await queryRunner.query(
        `ALTER TYPE "whatsapp_message_kind" ADD VALUE IF NOT EXISTS '${kind}'`,
      );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_messages" ADD "scheduled_for" TIMESTAMP WITH TIME ZONE`,
    );
    // A QR version is required for QR messages only; journey messages may carry none.
    await queryRunner.query(
      `ALTER TABLE "whatsapp_messages" DROP CONSTRAINT "CHK_whatsapp_messages_qr_version"`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "CHK_whatsapp_messages_qr_version" CHECK ("kind" NOT IN ('QR', 'QR_TEMPLATE') OR "qr_version" IS NOT NULL)`,
    );

    await queryRunner.query(
      `ALTER TYPE "whatsapp_inbound_outcome" ADD VALUE IF NOT EXISTS 'REVIEW'`,
    );
    await queryRunner.query(
      `CREATE TYPE "rsvp_review_decision" AS ENUM ('ACCEPTED', 'DISMISSED')`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_inbound" ADD "review_decision" "rsvp_review_decision"`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_inbound" ADD "review_decided_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_inbound" ADD "review_decided_by_user_id" uuid`,
    );

    await queryRunner.query(
      `ALTER TABLE "guests" ADD "reinstated_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Enum values cannot be dropped; rows using them are removed so the old code never reads them.
    await queryRunner.query(`ALTER TABLE "guests" DROP COLUMN "reinstated_at"`);
    await queryRunner.query(
      `ALTER TABLE "whatsapp_inbound" DROP COLUMN "review_decided_by_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_inbound" DROP COLUMN "review_decided_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_inbound" DROP COLUMN "review_decision"`,
    );
    await queryRunner.query(`DROP TYPE "rsvp_review_decision"`);
    await queryRunner.query(
      `UPDATE "whatsapp_inbound" SET "outcome" = 'IGNORED' WHERE "outcome" = 'REVIEW'`,
    );
    await queryRunner.query(
      `DELETE FROM "whatsapp_messages" WHERE "kind" IN ('FOLLOW_UP_1', 'FOLLOW_UP_2', 'REMINDER_1', 'REMINDER_FINAL', 'THANK_YOU', 'APOLOGY')`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_messages" DROP CONSTRAINT "CHK_whatsapp_messages_qr_version"`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "CHK_whatsapp_messages_qr_version" CHECK ("kind" = 'INVITATION' OR "qr_version" IS NOT NULL)`,
    );
    await queryRunner.query(
      `ALTER TABLE "whatsapp_messages" DROP COLUMN "scheduled_for"`,
    );
    await queryRunner.query(
      `ALTER TABLE "events" DROP COLUMN "contact_consent_by_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "events" DROP COLUMN "contact_consent_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "events" DROP CONSTRAINT "CHK_events_rsvp_closes_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "events" DROP COLUMN "rsvp_closes_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "events" DROP CONSTRAINT "CHK_events_journey"`,
    );
    await queryRunner.query(`ALTER TABLE "events" DROP COLUMN "journey"`);
  }
}
