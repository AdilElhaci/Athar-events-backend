import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialAuth1792795910832 implements MigrationInterface {
  name = 'InitialAuth1792795910832';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "admin_actions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "actor_user_id" uuid, "action" character varying(60) NOT NULL, "target_type" character varying(40) NOT NULL, "target_id" uuid, "summary" jsonb NOT NULL DEFAULT '{}', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_08d0b319675c4968ff9e0dca4c3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_admin_actions_created_at" ON "admin_actions"  ("created_at") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."users_type_enum" AS ENUM('OWNER', 'PLATFORM_ADMIN')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."users_status_enum" AS ENUM('ACTIVE', 'INVITED', 'SUSPENDED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "type" "public"."users_type_enum" NOT NULL, "status" "public"."users_status_enum" NOT NULL, "name" character varying(120) NOT NULL, "email" character varying(254) NOT NULL, "password_hash" character varying(255), "email_verified_at" TIMESTAMP WITH TIME ZONE, "session_version" integer NOT NULL DEFAULT '0', "password_changed_at" TIMESTAMP WITH TIME ZONE, "last_login_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."auth_tokens_purpose_enum" AS ENUM('REGISTER', 'PASSWORD_RESET', 'ADMIN_INVITE')`,
    );
    await queryRunner.query(
      `CREATE TABLE "auth_tokens" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "purpose" "public"."auth_tokens_purpose_enum" NOT NULL, "token_hash" character varying(64) NOT NULL, "user_id" uuid, "email" character varying(254) NOT NULL, "name" character varying(120), "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "used_at" TIMESTAMP WITH TIME ZONE, "revoked_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_3a94cfa1eada85ac2bf6f3016b7" UNIQUE ("token_hash"), CONSTRAINT "PK_41e9ddfbb32da18c4e85e45c2fd" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_auth_tokens_live" ON "auth_tokens"  ("email", "purpose") WHERE "used_at" IS NULL AND "revoked_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."email_challenges_purpose_enum" AS ENUM('REGISTER')`,
    );
    await queryRunner.query(
      `CREATE TABLE "email_challenges" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "purpose" "public"."email_challenges_purpose_enum" NOT NULL, "email" character varying(254) NOT NULL, "name" character varying(120), "code_hash" character varying(64) NOT NULL, "attempts" smallint NOT NULL DEFAULT '0', "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "consumed_at" TIMESTAMP WITH TIME ZONE, "superseded_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_e5ce7cf462b39f6cf03146d2b94" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_email_challenges_email_purpose" ON "email_challenges"  ("email", "purpose", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "sessions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "revoked_at" TIMESTAMP WITH TIME ZONE, "revoked_reason" character varying(40), "last_used_at" TIMESTAMP WITH TIME ZONE, "ip" character varying(64), "user_agent" character varying(255), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_3238ef96f18b355b671619111bc" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_sessions_user_id" ON "sessions"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "refresh_tokens" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "session_id" uuid NOT NULL, "token_hash" character varying(64) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "rotated_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_a7838d2ba25be1342091b6695f1" UNIQUE ("token_hash"), CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_refresh_tokens_session_id" ON "refresh_tokens"  ("session_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "auth_tokens" ADD CONSTRAINT "FK_9691367d446cd8b18f462c191b3" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "sessions" ADD CONSTRAINT "FK_085d540d9f418cfbdc7bd55bb19" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_3bf308fa93da3966f9e76fcfba4" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_3bf308fa93da3966f9e76fcfba4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sessions" DROP CONSTRAINT "FK_085d540d9f418cfbdc7bd55bb19"`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth_tokens" DROP CONSTRAINT "FK_9691367d446cd8b18f462c191b3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_refresh_tokens_session_id"`,
    );
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_sessions_user_id"`);
    await queryRunner.query(`DROP TABLE "sessions"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_email_challenges_email_purpose"`,
    );
    await queryRunner.query(`DROP TABLE "email_challenges"`);
    await queryRunner.query(
      `DROP TYPE "public"."email_challenges_purpose_enum"`,
    );
    await queryRunner.query(`DROP INDEX "public"."UQ_auth_tokens_live"`);
    await queryRunner.query(`DROP TABLE "auth_tokens"`);
    await queryRunner.query(`DROP TYPE "public"."auth_tokens_purpose_enum"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "public"."users_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."users_type_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_admin_actions_created_at"`,
    );
    await queryRunner.query(`DROP TABLE "admin_actions"`);
  }
}
