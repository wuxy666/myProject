import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as Joi from 'joi';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { loadDatabaseConfig } from './config/database-config';
import { NetworkDashboardModule } from './dashboard/network-dashboard.module';

const databaseConfig = loadDatabaseConfig();

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [() => databaseConfig],
      validationSchema: Joi.object({
        NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
        PORT: Joi.number().port().default(3000),
        DATABASE_URL: Joi.string().required(),
        CORS_ORIGIN: Joi.string().default('http://localhost:3000'),
        JWT_SECRET: Joi.string().min(32).required(),
        JWT_EXPIRES_IN: Joi.string().default('2h'),
      }),
    }),
    PrismaModule,
    AuthModule,
    NetworkDashboardModule,
  ],
})
export class AppModule {}
