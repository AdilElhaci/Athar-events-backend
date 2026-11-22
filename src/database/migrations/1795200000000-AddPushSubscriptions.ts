import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Web Push subscriptions of admins (new inbox messages reach their phone or browser even when
 * the dashboard is closed). One row per device; it goes with its user. Expand-only.
 */
export class AddPushSubscriptions1795200000000 implements MigrationInterface {
  name = 'AddPushSubscriptions1795200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "push_subscriptions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "endpoint" character varying(1024) NOT NULL,
        "p256dh" character varying(128) NOT NULL,
        "auth" character varying(64) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_push_subscriptions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_push_subscriptions_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_push_subscriptions_endpoint" ON "push_subscriptions" ("endpoint")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_push_subscriptions_user" ON "push_subscriptions" ("user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "push_subscriptions"`);
  }
}
