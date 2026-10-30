import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { sha256 } from '../utils/crypto.util';

export const REDIS = Symbol('REDIS');

const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 or redis.call('TTL', KEYS[1]) < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count`;

/**
 * Fixed-window counters in Redis, shared by every API instance. Keys hash personal
 * data (emails) so Redis never stores them in clear text.
 */
@Injectable()
export class RateLimitService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Records one hit; returns false when the limit for the window is already used up. */
  async hit(
    scope: string,
    subject: string,
    limit: number,
    windowSeconds: number,
  ): Promise<boolean> {
    const key = `rl:${scope}:${sha256(subject)}`;
    // INCR and EXPIRE in one atomic script; also repairs a counter that somehow lost its TTL.
    const count = (await this.redis.eval(
      HIT_SCRIPT,
      1,
      key,
      windowSeconds,
    )) as number;
    return count <= limit;
  }

  /** Clears a counter (for example failed logins after a successful one). */
  async reset(scope: string, subject: string): Promise<void> {
    await this.redis.del(`rl:${scope}:${sha256(subject)}`);
  }

  /**
   * Per-address email budget: one message per cooldown and a cap per hour. Applies to every
   * email we send to that address, whatever triggered it, to stop mail-bombing.
   */
  async allowEmailTo(email: string): Promise<boolean> {
    const cooldownKey = `mail:cooldown:${sha256(email)}`;
    const firstInCooldown = await this.redis.set(
      cooldownKey,
      '1',
      'EX',
      60,
      'NX',
    );
    if (firstInCooldown !== 'OK') return false;
    return this.hit('mail:hour', email, 5, 3600);
  }
}
