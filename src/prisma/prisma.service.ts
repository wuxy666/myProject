import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  // Each registered connection uses the current generated Prisma model contract.
  private readonly clients = new Map<string, PrismaClient>();

  constructor(config: ConfigService) {
    const databases = config.getOrThrow<Record<string, { url: string }>>('databases');
    for (const [name, database] of Object.entries(databases)) {
      this.clients.set(name, new PrismaClient({ datasources: { db: { url: database.url } } }));
    }
  }

  async onModuleInit(): Promise<void> {
    await Promise.all([...this.clients.values()].map((client) => client.$connect()));
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.clients.values()].map((client) => client.$disconnect()));
  }

  getClient(name: string): PrismaClient {
    const client = this.clients.get(name);
    if (!client) {
      throw new Error(`Database "${name}" is not configured. Available: ${[...this.clients.keys()].join(', ')}`);
    }
    return client;
  }
}
