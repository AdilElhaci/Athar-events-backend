import { bullConnection } from './whatsapp-queue.service';

describe('bullConnection', () => {
  it('reads host, port, credentials and database from REDIS_URL', () => {
    expect(bullConnection('redis://user:p%40ss@cache.internal:6380/2')).toEqual(
      {
        host: 'cache.internal',
        port: 6380,
        username: 'user',
        password: 'p@ss',
        db: 2,
        tls: undefined,
        maxRetriesPerRequest: null,
      },
    );
  });

  it('defaults the port and database, and turns on TLS for rediss', () => {
    expect(bullConnection('rediss://cache.example.com')).toMatchObject({
      port: 6379,
      db: 0,
      tls: {},
      username: undefined,
      password: undefined,
    });
  });
});
