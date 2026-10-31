import { MigrationInterface, QueryRunner } from 'typeorm';

/** Optional Saudi mobile on the user profile (expand-only: nullable, no backfill). */
export class AddUserPhone1793480000000 implements MigrationInterface {
  name = 'AddUserPhone1793480000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "phone" character varying(20)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "phone"`);
  }
}
