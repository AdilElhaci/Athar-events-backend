import { Coupon, CouponType } from './entities/coupon.entity';

/** D-48: a discounted event still costs at least 1 SAR (Moyasar refuses a zero invoice). */
export const MIN_CHARGE_HALALAS = 100;

/** The discount on `priceHalalas`, capped so the owner still pays the minimum. 0 = not applicable. */
export function discountFor(
  coupon: Pick<Coupon, 'type' | 'value'>,
  priceHalalas: number,
): number {
  const raw =
    coupon.type === CouponType.PERCENT
      ? Math.floor((priceHalalas * coupon.value) / 100)
      : coupon.value;
  return Math.max(0, Math.min(raw, priceHalalas - MIN_CHARGE_HALALAS));
}

/** Active, not expired and under its limit. */
export const couponUsable = (
  coupon: Pick<Coupon, 'isActive' | 'expiresAt' | 'maxUses' | 'usedCount'>,
  now = new Date(),
): boolean =>
  coupon.isActive &&
  (!coupon.expiresAt || coupon.expiresAt.getTime() > now.getTime()) &&
  (coupon.maxUses === null || coupon.usedCount < coupon.maxUses);

/** What Moyasar charges for the event. */
export const amountDue = (event: {
  priceHalalas: number;
  discountHalalas: number;
}): number => event.priceHalalas - event.discountHalalas;
