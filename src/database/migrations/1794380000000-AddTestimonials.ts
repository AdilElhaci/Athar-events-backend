import { MigrationInterface, QueryRunner } from 'typeorm';

/** Client reviews shown on the public «آراء العملاء» page (owner request 2026-11-10). Expand-only. */
export class AddTestimonials1794380000000 implements MigrationInterface {
  name = 'AddTestimonials1794380000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "testimonial_status" AS ENUM('DRAFT', 'PUBLISHED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "testimonials" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "author_name" character varying(80) NOT NULL, "author_title" character varying(120), "quote" character varying(600) NOT NULL, "status" "testimonial_status" NOT NULL DEFAULT 'DRAFT', "sort_order" integer NOT NULL DEFAULT 0, "published_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_testimonials_published_at" CHECK ("status" <> 'PUBLISHED' OR "published_at" IS NOT NULL), CONSTRAINT "PK_testimonials" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_testimonials_status_sort" ON "testimonials" ("status", "sort_order")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_testimonials_status_sort"`);
    await queryRunner.query(`DROP TABLE "testimonials"`);
    await queryRunner.query(`DROP TYPE "testimonial_status"`);
  }
}
