import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * D-48 coupons: a percentage or fixed discount on an event's price. An owner uses a coupon on
 * one event only (unique owner + coupon), and the event still costs at least 1 SAR.
 * Expand-only: existing events get no coupon and no discount.
 */
export class AddCoupons1794920000000 implements MigrationInterface {
  name = 'AddCoupons1794920000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "coupon_type" AS ENUM('PERCENT', 'FIXED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "coupons" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "code" character varying(30) NOT NULL, "type" "coupon_type" NOT NULL, "value" integer NOT NULL, "max_uses" integer, "used_count" integer NOT NULL DEFAULT 0, "expires_at" TIMESTAMP WITH TIME ZONE, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_coupons_value" CHECK ("value" > 0 AND ("type" <> 'PERCENT' OR "value" <= 99)), CONSTRAINT "CHK_coupons_max_uses" CHECK ("max_uses" IS NULL OR "max_uses" > 0), CONSTRAINT "CHK_coupons_used_count" CHECK ("used_count" >= 0), CONSTRAINT "PK_coupons" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_coupons_code" ON "coupons" ("code")`,
    );
    await queryRunner.query(`ALTER TABLE "events" ADD "coupon_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "events" ADD "coupon_code" character varying(30)`,
    );
    await queryRunner.query(
      `ALTER TABLE "events" ADD "discount_halalas" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "events" ADD CONSTRAINT "FK_events_coupon" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "events" ADD CONSTRAINT "CHK_events_discount" CHECK (("coupon_id" IS NULL AND "coupon_code" IS NULL AND "discount_halalas" = 0) OR ("coupon_id" IS NOT NULL AND "coupon_code" IS NOT NULL AND "discount_halalas" > 0 AND "price_halalas" - "discount_halalas" >= 100))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_events_owner_coupon" ON "events" ("owner_id", "coupon_id") WHERE "coupon_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_events_owner_coupon"`);
    await queryRunner.query(
      `ALTER TABLE "events" DROP CONSTRAINT "CHK_events_discount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "events" DROP CONSTRAINT "FK_events_coupon"`,
    );
    await queryRunner.query(
      `ALTER TABLE "events" DROP COLUMN "discount_halalas"`,
    );
    await queryRunner.query(`ALTER TABLE "events" DROP COLUMN "coupon_code"`);
    await queryRunner.query(`ALTER TABLE "events" DROP COLUMN "coupon_id"`);
    await queryRunner.query(`DROP INDEX "UQ_coupons_code"`);
    await queryRunner.query(`DROP TABLE "coupons"`);
    await queryRunner.query(`DROP TYPE "coupon_type"`);
  }
}
