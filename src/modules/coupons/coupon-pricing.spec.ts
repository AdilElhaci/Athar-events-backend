import { couponUsable, discountFor } from './coupon-pricing';
import { CouponType } from './entities/coupon.entity';

describe('D-48 coupon pricing', () => {
  it('takes a percentage, rounded down to the halala', () => {
    expect(discountFor({ type: CouponType.PERCENT, value: 20 }, 150_000)).toBe(
      30_000,
    );
    expect(discountFor({ type: CouponType.PERCENT, value: 33 }, 1_001)).toBe(
      330,
    );
  });

  it('takes a fixed amount, leaving at least 1 SAR', () => {
    expect(discountFor({ type: CouponType.FIXED, value: 5_000 }, 150_000)).toBe(
      5_000,
    );
    expect(
      discountFor({ type: CouponType.FIXED, value: 900_000 }, 150_000),
    ).toBe(149_900);
    expect(discountFor({ type: CouponType.PERCENT, value: 99 }, 5_000)).toBe(
      4_900,
    );
    expect(discountFor({ type: CouponType.FIXED, value: 5_000 }, 100)).toBe(0);
  });

  it('is usable only while active, unexpired and under its limit', () => {
    const now = new Date('2026-11-16T12:00:00Z');
    const base = {
      isActive: true,
      expiresAt: null,
      maxUses: null,
      usedCount: 7,
    };
    expect(couponUsable(base, now)).toBe(true);
    expect(couponUsable({ ...base, isActive: false }, now)).toBe(false);
    expect(
      couponUsable(
        { ...base, expiresAt: new Date('2026-11-16T11:59:59Z') },
        now,
      ),
    ).toBe(false);
    expect(
      couponUsable(
        { ...base, expiresAt: new Date('2026-11-17T00:00:00Z') },
        now,
      ),
    ).toBe(true);
    expect(couponUsable({ ...base, maxUses: 7 }, now)).toBe(false);
    expect(couponUsable({ ...base, maxUses: 8 }, now)).toBe(true);
  });
});
