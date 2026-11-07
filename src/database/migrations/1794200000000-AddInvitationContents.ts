import { MigrationInterface, QueryRunner } from 'typeorm';

/** Invitation versions and the approved one on the event (SP-04, D-15). Expand-only. */
export class AddInvitationContents1794200000000 implements MigrationInterface {
  name = 'AddInvitationContents1794200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "invitation_contents" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "event_id" uuid NOT NULL, "version" integer NOT NULL, "template_name" character varying(120) NOT NULL, "template_language" character varying(10) NOT NULL, "variables" jsonb NOT NULL, "rendered_preview" text NOT NULL, "content_hash" character varying(64) NOT NULL, "created_by_user_id" uuid NOT NULL, "approved_at" TIMESTAMP WITH TIME ZONE, "approved_by_user_id" uuid, "override_reason" character varying(300), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_invitation_contents" PRIMARY KEY ("id"), CONSTRAINT "FK_invitation_contents_event" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_invitation_contents_event_version" ON "invitation_contents" ("event_id", "version")`,
    );
    await queryRunner.query(
      `ALTER TABLE "events" ADD "approved_content_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "events" ADD CONSTRAINT "FK_events_approved_content" FOREIGN KEY ("approved_content_id") REFERENCES "invitation_contents"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "events" DROP CONSTRAINT "FK_events_approved_content"`,
    );
    await queryRunner.query(
      `ALTER TABLE "events" DROP COLUMN "approved_content_id"`,
    );
    await queryRunner.query(`DROP TABLE "invitation_contents"`);
  }
}
