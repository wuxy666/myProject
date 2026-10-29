import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CapabilityQueryDto,
  ChangeSummaryQueryDto,
  DateQueryDto,
  NetworkScaleQueryDto,
  RankingQueryDto,
  SplitRatioQueryDto,
} from './dto/network-dashboard-query.dto';
import { NetworkDashboardService } from './network-dashboard.service';

@Controller('dashboard/network')
@UseGuards(JwtAuthGuard)
export class NetworkDashboardController {
  constructor(private readonly dashboard: NetworkDashboardService) {}

  @Get('status')
  getStatus() {
    return this.dashboard.getStatus();
  }

  @Get('service-metrics')
  getServiceMetrics() {
    return this.dashboard.getServiceMetrics();
  }

  @Get('tickets/summary')
  getTicketSummary() {
    return this.dashboard.getTicketSummary();
  }

  @Get('health/provinces')
  getProvinceHealth(@Query() query: RankingQueryDto) {
    return this.dashboard.getProvinceHealth(query);
  }

  @Get('subscribers/provinces')
  getProvinceSubscribers(@Query() query: DateQueryDto) {
    return this.dashboard.getProvinceSubscribers(query.date);
  }

  @Get('changes/summary')
  getChangeSummary(@Query() query: ChangeSummaryQueryDto) {
    return this.dashboard.getChangeSummary(query.window);
  }

  @Get('capacity/summary')
  getCapacitySummary() {
    return this.dashboard.getCapacitySummary();
  }

  @Get('scale')
  getNetworkScale(@Query() query: NetworkScaleQueryDto) {
    return this.dashboard.getNetworkScale(query.category);
  }

  @Get('split-ratio')
  getSplitRatio(@Query() query: SplitRatioQueryDto) {
    return this.dashboard.getSplitRatio(query);
  }

  @Get('capabilities')
  getCapabilities(@Query() query: CapabilityQueryDto) {
    return this.dashboard.getCapabilities(query);
  }
}
