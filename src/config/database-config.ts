import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as dotenv from 'dotenv';

const yaml = require('js-yaml') as { load: (source: string) => unknown };

type Environment = 'development' | 'test' | 'production';
type DatabaseValues = {
  provider: string;
  host: string;
  port: string | number;
  database: string;
  username: string;
  password: string;
  connectionLimit: string | number;
};

type EnvironmentValues = { databases: Record<string, DatabaseValues> };

function loadEnvironmentFiles(environment: Environment): void {
  dotenv.config({ path: [`.env.${environment}`, '.env'] });
}

function interpolate(value: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/g, (_match, name: string, fallback?: string) => {
    const configured = process.env[name];
    if (configured !== undefined && configured !== '') return configured;
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable: ${name}`);
  });
}

function resolveValues(values: DatabaseValues): DatabaseValues {
  return {
    provider: interpolate(values.provider),
    host: interpolate(values.host),
    port: interpolate(String(values.port)),
    database: interpolate(values.database),
    username: interpolate(values.username),
    password: interpolate(values.password),
    connectionLimit: interpolate(String(values.connectionLimit)),
  };
}

export function loadDatabaseConfig() {
  const rawEnvironment = process.env.NODE_ENV || 'development';
  if (!['development', 'test', 'production'].includes(rawEnvironment)) {
    throw new Error(`Unsupported NODE_ENV: ${rawEnvironment}`);
  }

  const environment = rawEnvironment as Environment;
  loadEnvironmentFiles(environment);

  const configPath = resolve(process.cwd(), 'config/database.yaml');
  const yamlContent = readFileSync(configPath, 'utf8');
  const configuration = yaml.load(yamlContent) as Record<Environment, EnvironmentValues>;
  const configuredDatabases = configuration[environment]?.databases;
  if (!configuredDatabases || Object.keys(configuredDatabases).length === 0) {
    throw new Error(`No databases configured for ${environment}`);
  }

  const databases = Object.fromEntries(
    Object.entries(configuredDatabases).map(([name, values]) => {
      const database = resolveValues(values);
      const port = Number(database.port);
      const connectionLimit = Number(database.connectionLimit);

      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid database port for ${environment}.${name}`);
      }
      if (!Number.isInteger(connectionLimit) || connectionLimit < 1) {
        throw new Error(`Invalid connection limit for ${environment}.${name}`);
      }

      const url = `mysql://${encodeURIComponent(database.username)}:${encodeURIComponent(database.password)}@${database.host}:${port}/${encodeURIComponent(database.database)}?connection_limit=${connectionLimit}`;
      return [name, { ...database, port, connectionLimit, url }];
    }),
  );

  if (!databases.devices) {
    throw new Error('The "devices" database must be configured for prisma/schema.prisma.');
  }

  // Keep the legacy URL as the Prisma CLI default while exposing all named
  // connections to NestJS. An explicitly configured DATABASE_URL still
  // overrides the devices connection for backwards compatibility.
  if (databases.devices) {
    if (process.env.DATABASE_URL) databases.devices.url = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databases.devices.url;
  }

  return { database: databases.devices, databases };
}
