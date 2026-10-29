import { defineConfig } from 'prisma/config';
import { loadDatabaseConfig } from './src/config/database-config';

const databaseConfig = loadDatabaseConfig();
const devicesDatabase = databaseConfig.databases.devices;

if (!devicesDatabase) {
  throw new Error('The "devices" database must be configured for the default Prisma schema.');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: devicesDatabase.url },
});
