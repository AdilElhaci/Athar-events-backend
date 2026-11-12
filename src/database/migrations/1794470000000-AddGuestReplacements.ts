import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * D-16 replacements (T-P4-01): a reserve guest records the decline that funded it. Each decline
 * funds at most one replacement (partial unique), and only reserve guests can be replacements.
 * Expand-only.
 */
export class AddGuestReplacements1794470000000 implements MigrationInterface {
  name = 'AddGuestReplacements1794470000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "guests" ADD "replacement_for_guest_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "guests" ADD CONSTRAINT "FK_guests_replacement_for" FOREIGN KEY ("replacement_for_guest_id") REFERENCES "guests"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "guests" ADD CONSTRAINT "CHK_guests_replacement_reserve" CHECK ("kind" = 'RESERVE' OR "replacement_for_guest_id" IS NULL)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_guests_replacement_for" ON "guests" ("replacement_for_guest_id") WHERE "replacement_for_guest_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_guests_replacement_for"`);
    await queryRunner.query(
      `ALTER TABLE "guests" DROP CONSTRAINT "CHK_guests_replacement_reserve"`,
    );
    await queryRunner.query(
      `ALTER TABLE "guests" DROP CONSTRAINT "FK_guests_replacement_for"`,
    );
    await queryRunner.query(
      `ALTER TABLE "guests" DROP COLUMN "replacement_for_guest_id"`,
    );
  }
}
