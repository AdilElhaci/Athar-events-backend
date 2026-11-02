import { MigrationInterface, QueryRunner } from 'typeorm';

const COMPLETE = `"published_at" IS NOT NULL AND "excerpt" IS NOT NULL AND "reading_minutes" IS NOT NULL AND "cover_url" IS NOT NULL AND "cover_alt" IS NOT NULL AND jsonb_array_length("sections") > 0`;

/** Category and takeaway no longer block publishing (relaxes a check; no data changes). */
export class RelaxArticlePublishCheck1794020000000 implements MigrationInterface {
  name = 'RelaxArticlePublishCheck1794020000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "articles" DROP CONSTRAINT "CHK_articles_published_complete"`,
    );
    await queryRunner.query(
      `ALTER TABLE "articles" ADD CONSTRAINT "CHK_articles_published_complete" CHECK ("status" <> 'PUBLISHED' OR (${COMPLETE}))`,
    );
  }

  /** Fails while a published article lacks a category or takeaway; fill or unpublish it first. */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "articles" DROP CONSTRAINT "CHK_articles_published_complete"`,
    );
    await queryRunner.query(
      `ALTER TABLE "articles" ADD CONSTRAINT "CHK_articles_published_complete" CHECK ("status" <> 'PUBLISHED' OR (${COMPLETE} AND "category" IS NOT NULL AND "takeaway" IS NOT NULL))`,
    );
  }
}
