import { createPool, runMigrations } from '@oat/data';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';

/**
 * Standalone migration entrypoint.
 *
 * The API can migrate at start-up, and does locally, because one process
 * against one database is unambiguous. In a cluster it must not: several API
 * replicas would race to apply the same DDL on every rollout, and the losers
 * would either error or block.
 *
 * So the Helm chart runs this as a pre-upgrade Job instead — exactly one
 * process, finishing before any new pod starts. A non-zero exit fails the
 * release with the previous version still serving, which is the outcome you
 * want when a migration is broken.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger(config, 'migrate');

  const db = createPool({
    connectionString: config.DATABASE_URL,
    // One connection is enough, and taking a large pool for a task that exits
    // in seconds is rude to whatever else is using the database.
    max: 2,
    ssl: config.DATABASE_SSL,
    applicationName: 'migrate',
  });

  try {
    log.info('applying migrations');
    await runMigrations(db, log);
    log.info('migrations up to date');
  } finally {
    await db.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('migration failed:', err);
    process.exit(1);
  });
