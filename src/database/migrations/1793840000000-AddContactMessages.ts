import { MigrationInterface, QueryRunner } from 'typeorm';

/** Stored contact-form messages (expand-only: a new table, starts empty). */
export class AddContactMessages1793840000000 implements MigrationInterface {
  name = 'AddContactMessages1793840000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "contact_message_status" AS ENUM('NEW', 'READ', 'REPLIED', 'CLOSED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "contact_messages" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" character varying(120) NOT NULL, "phone" character varying(20) NOT NULL, "subject" text NOT NULL, "status" "contact_message_status" NOT NULL DEFAULT 'NEW', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_contact_messages" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_contact_messages_created_at" ON "contact_messages" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_contact_messages_status" ON "contact_messages" ("status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "contact_messages"`);
    await queryRunner.query(`DROP TYPE "contact_message_status"`);
  }
}
