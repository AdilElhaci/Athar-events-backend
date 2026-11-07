import { MigrationInterface, QueryRunner } from 'typeorm';

/** Guests and sheet imports (SP-03). Expand-only: three new tables, start empty. */
export class AddGuests1794110000000 implements MigrationInterface {
  name = 'AddGuests1794110000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "guest_kind" AS ENUM('INITIAL', 'RESERVE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "guest_source" AS ENUM('MANUAL', 'IMPORT')`,
    );
    await queryRunner.query(
      `CREATE TYPE "guest_allocation_status" AS ENUM('NOT_ALLOCATED', 'ALLOCATED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "guest_rsvp" AS ENUM('PENDING', 'ACCEPTED', 'DECLINED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "guests" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "event_id" uuid NOT NULL, "name" character varying(120) NOT NULL, "phone" character varying(16), "kind" "guest_kind" NOT NULL DEFAULT 'INITIAL', "source" "guest_source" NOT NULL DEFAULT 'MANUAL', "import_id" uuid, "allocation_status" "guest_allocation_status" NOT NULL DEFAULT 'NOT_ALLOCATED', "allocated_at" TIMESTAMP WITH TIME ZONE, "rsvp" "guest_rsvp" NOT NULL DEFAULT 'PENDING', "rsvp_at" TIMESTAMP WITH TIME ZONE, "checked_in_at" TIMESTAMP WITH TIME ZONE, "note" character varying(200), "deleted_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_guests" PRIMARY KEY ("id"), CONSTRAINT "FK_guests_event" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT, CONSTRAINT "CHK_guests_deleted_unallocated" CHECK ("deleted_at" IS NULL OR "allocation_status" = 'NOT_ALLOCATED'))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_guests_event_id" ON "guests" ("event_id")`,
    );
    // OQ-03: one live guest per phone and event (deleted rows free the number).
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_guests_event_phone" ON "guests" ("event_id", "phone") WHERE "deleted_at" IS NULL AND "phone" IS NOT NULL`,
    );

    await queryRunner.query(
      `CREATE TYPE "guest_import_status" AS ENUM('PREVIEWED', 'APPLIED', 'EXPIRED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "guest_import_row_result" AS ENUM('VALID', 'INVALID', 'DUPLICATE_IN_FILE', 'DUPLICATE_EXISTING', 'OVER_LIMIT')`,
    );
    await queryRunner.query(
      `CREATE TABLE "guest_imports" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "event_id" uuid NOT NULL, "file_name" character varying(120) NOT NULL, "file_sha256" character varying(64) NOT NULL, "status" "guest_import_status" NOT NULL DEFAULT 'PREVIEWED', "counts" jsonb NOT NULL, "created_by_user_id" uuid NOT NULL, "applied_by_user_id" uuid, "applied_at" TIMESTAMP WITH TIME ZONE, "preview_expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_guest_imports" PRIMARY KEY ("id"), CONSTRAINT "FK_guest_imports_event" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_guest_imports_event_id" ON "guest_imports" ("event_id")`,
    );
    await queryRunner.query(
      `CREATE TABLE "guest_import_rows" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "import_id" uuid NOT NULL, "row_number" integer NOT NULL, "raw_name" character varying(160) NOT NULL, "raw_phone" character varying(40) NOT NULL, "name" character varying(120), "phone" character varying(16), "kind" "guest_kind", "note" character varying(200), "result" "guest_import_row_result" NOT NULL, "reason" character varying(60), CONSTRAINT "PK_guest_import_rows" PRIMARY KEY ("id"), CONSTRAINT "FK_guest_import_rows_import" FOREIGN KEY ("import_id") REFERENCES "guest_imports"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_guest_import_rows_import_id_row_number" ON "guest_import_rows" ("import_id", "row_number")`,
    );
    await queryRunner.query(
      `ALTER TABLE "guests" ADD CONSTRAINT "FK_guests_import" FOREIGN KEY ("import_id") REFERENCES "guest_imports"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "guests" DROP CONSTRAINT "FK_guests_import"`,
    );
    await queryRunner.query(`DROP TABLE "guest_import_rows"`);
    await queryRunner.query(`DROP TABLE "guest_imports"`);
    await queryRunner.query(`DROP TYPE "guest_import_row_result"`);
    await queryRunner.query(`DROP TYPE "guest_import_status"`);
    await queryRunner.query(`DROP TABLE "guests"`);
    await queryRunner.query(`DROP TYPE "guest_rsvp"`);
    await queryRunner.query(`DROP TYPE "guest_allocation_status"`);
    await queryRunner.query(`DROP TYPE "guest_source"`);
    await queryRunner.query(`DROP TYPE "guest_kind"`);
  }
}
