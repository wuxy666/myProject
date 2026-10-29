import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NetworkDashboardController } from './network-dashboard.controller';
import { NetworkDashboardService } from './network-dashboard.service';

@Module({
  imports: [AuthModule],
  controllers: [NetworkDashboardController],
  providers: [NetworkDashboardService],
})
export class NetworkDashboardModule {}
