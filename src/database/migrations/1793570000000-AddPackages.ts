import { MigrationInterface, QueryRunner } from 'typeorm';

/** Package catalogue (expand-only: a new table, starts empty). */
export class AddPackages1793570000000 implements MigrationInterface {
  name = 'AddPackages1793570000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "packages" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" character varying(80) NOT NULL, "description" text, "invitation_allowance" integer NOT NULL, "extra_margin" integer NOT NULL, "price_halalas" integer NOT NULL, "currency" character varying(3) NOT NULL DEFAULT 'SAR', "is_active" boolean NOT NULL DEFAULT false, "is_featured" boolean NOT NULL DEFAULT false, "sort_order" integer NOT NULL DEFAULT 0, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_packages_invitation_allowance" CHECK ("invitation_allowance" > 0), CONSTRAINT "CHK_packages_extra_margin" CHECK ("extra_margin" >= 0), CONSTRAINT "CHK_packages_price_halalas" CHECK ("price_halalas" > 0), CONSTRAINT "PK_packages" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "packages"`);
  }
}
