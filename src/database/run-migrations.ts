import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './data-source';

/**
 * Release step: runs pending migrations once, as the migration role (operations.md).
 * The API itself connects as the application role and never migrates at boot.
 */
async function runMigrations(): Promise<void> {
  const { MIGRATION_DB_USER, MIGRATION_DB_PASSWORD } = process.env;
  if (!MIGRATION_DB_USER || !MIGRATION_DB_PASSWORD) {
    throw new Error('MIGRATION_DB_USER and MIGRATION_DB_PASSWORD are required');
  }

  const dataSource = new DataSource(
    buildDataSourceOptions({
      ...process.env,
      DB_USER: MIGRATION_DB_USER,
      DB_PASSWORD: MIGRATION_DB_PASSWORD,
    }),
  );
  await dataSource.initialize();
  try {
    const applied = await dataSource.runMigrations({ transaction: 'each' });
    console.log(
      applied.length === 0
        ? 'No pending migrations.'
        : `Applied ${applied.length} migration(s): ${applied.map((m) => m.name).join(', ')}`,
    );
  } finally {
    await dataSource.destroy();
  }
}

runMigrations().catch((error: unknown) => {
  console.error(
    'Migration failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
