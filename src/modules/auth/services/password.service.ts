import { Injectable, OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';
import { tooManyRequests } from '../../../shared/exceptions/app.exception';
import { normalizePassword } from '../utils/password-policy';

/** OWASP argon2id baseline: 19 MiB, 2 iterations, 1 lane. Re-hash on login when these change. */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** Bounds simultaneous hash operations so a burst of logins cannot exhaust memory/CPU. */
const MAX_CONCURRENT_HASHES = 4;
const MAX_QUEUED_HASHES = 64;

@Injectable()
export class PasswordService implements OnModuleInit {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private dummyHash = '';

  async onModuleInit(): Promise<void> {
    // Verified when the account does not exist, so unknown emails cost the same time as known ones.
    this.dummyHash = await argon2.hash(
      'athar-events-dummy-password',
      ARGON2_OPTIONS,
    );
  }

  hash(password: string): Promise<string> {
    return this.limited(() =>
      argon2.hash(normalizePassword(password), ARGON2_OPTIONS),
    );
  }

  /** Always performs one argon2 verification, against the dummy hash when `hash` is missing. */
  verify(hash: string | null, password: string): Promise<boolean> {
    return this.limited(async () => {
      const ok = await argon2.verify(
        hash ?? this.dummyHash,
        normalizePassword(password),
      );
      return Boolean(hash) && ok;
    });
  }

  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, ARGON2_OPTIONS);
  }

  private async limited<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= MAX_CONCURRENT_HASHES) {
      if (this.waiting.length >= MAX_QUEUED_HASHES) throw tooManyRequests();
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}
