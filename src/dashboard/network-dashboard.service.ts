import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CapabilityCategory,
  ChangeWindow,
  NetworkScaleCategory,
  RankingQueryDto,
  SortOrder,
  SplitRatioQueryDto,
} from './dto/network-dashboard-query.dto';
import type { CapabilityQueryDto } from './dto/network-dashboard-query.dto';

type TimedStatusRow = { status: string; label: string; updatedAt: Date };
type MetricRow = { metricKey: string; name: string; value: number | Prisma.Decimal; unit: string; status: string; updatedAt: Date };
type TicketRow = { groupKey: string; groupName: string; statusKey: string; statusName: string; count: number };
type HealthRow = { adcode: string; name: string; score: number | Prisma.Decimal; level: string | null };
type DateRow = { statDate: Date | string | null };

function numeric(value: number | bigint | Prisma.Decimal | null | undefined): number {
  return value === null || value === undefined ? 0 : Number(value);
}

function dateOnly(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

function dateSnapshotTime(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return `${dateOnly(value)}T00:00:00+08:00`;
}

function isoTime(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

@Injectable()
export class NetworkDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  private get client() {
    return this.prisma.getClient('networkMonitor');
  }

  async getStatus() {
    const rows = await this.client.$queryRaw<TimedStatusRow[]>(Prisma.sql`
      SELECT status_key AS status, status_label AS label, captured_at AS updatedAt
      FROM dashboard_status_snapshot
      ORDER BY captured_at DESC
      LIMIT 1
    `);
    const row = rows[0];
    return {
      status: row?.status ?? 'unknown',
      label: row?.label ?? '核心网状态未知',
      updatedAt: isoTime(row?.updatedAt),
    };
  }

  async getServiceMetrics() {
    const rows = await this.client.$queryRaw<MetricRow[]>(Prisma.sql`
      SELECT metric_key AS metricKey, metric_name AS name,
             metric_value AS value, unit, status_key AS status, collected_at AS updatedAt
      FROM service_metric_snapshot
      WHERE collected_at = (SELECT MAX(collected_at) FROM service_metric_snapshot)
      ORDER BY metric_key
    `);
    return {
      items: rows.map((row) => ({ key: row.metricKey, name: row.name, value: numeric(row.value), unit: row.unit, status: row.status })),
      updatedAt: isoTime(rows[0]?.updatedAt),
    };
  }

  async getTicketSummary() {
    const rows = await this.client.$queryRaw<TicketRow[]>(Prisma.sql`
      SELECT group_key AS groupKey, group_name AS groupName,
             status_key AS statusKey, status_name AS statusName, ticket_count AS count
      FROM ticket_status_snapshot
      WHERE stat_date = (SELECT MAX(stat_date) FROM ticket_status_snapshot)
      ORDER BY group_key, status_key
    `);
    const groups = new Map<string, { key: string; name: string; total: number; statuses: { key: string; name: string; count: number }[] }>();
    for (const row of rows) {
      let group = groups.get(row.groupKey);
      if (!group) {
        group = { key: row.groupKey, name: row.groupName, total: 0, statuses: [] };
        groups.set(row.groupKey, group);
      }
      const count = numeric(row.count);
      group.statuses.push({ key: row.statusKey, name: row.statusName, count });
      group.total += count;
    }
    const latest = await this.latestDate('ticket_status_snapshot');
    return { groups: [...groups.values()], updatedAt: dateSnapshotTime(latest) };
  }

  async getProvinceHealth(query: RankingQueryDto) {
    const latest = await this.latestDate('health_score_snapshot');
    if (!latest) return { nationalScore: 0, nationalLevel: '未知', unit: '%', provinces: [], updatedAt: null };
    const nationalRows = await this.client.$queryRaw<Array<{ score: number | Prisma.Decimal; level: string | null }>>(Prisma.sql`
      SELECT score, level_name AS level FROM health_score_snapshot
      WHERE stat_date = ${dateOnly(latest)} AND scope_key = 'national'
      LIMIT 1
    `);
    const order = query.order === SortOrder.ASC ? Prisma.raw('ASC') : Prisma.raw('DESC');
    const provinces = await this.client.$queryRaw<HealthRow[]>(Prisma.sql`
      SELECT adcode, region_name AS name, score, level_name AS level
      FROM health_score_snapshot
      WHERE stat_date = ${dateOnly(latest)} AND scope_key = 'province'
      ORDER BY score ${order}, adcode ASC
      LIMIT ${query.limit}
    `);
    return {
      nationalScore: numeric(nationalRows[0]?.score),
      nationalLevel: nationalRows[0]?.level ?? '未知',
      unit: '%',
      provinces: provinces.map((row, index) => ({
        adcode: row.adcode,
        name: row.name,
        score: numeric(row.score),
        rank: index + 1,
        level: row.level ?? '未知',
      })),
      updatedAt: dateSnapshotTime(latest),
    };
  }

  async getProvinceSubscribers(requestedDate?: string) {
    const dateRows = requestedDate
      ? [{ statDate: requestedDate }]
      : await this.client.$queryRaw<DateRow[]>(Prisma.sql`
          SELECT MAX(stat_date) AS statDate FROM subscriber_total_snapshot
        `);
    const statDate = dateRows[0]?.statDate;
    if (!statDate) return { total: 0, unit: '户', date: requestedDate ?? null, provinces: [], updatedAt: null };
    const date = dateOnly(statDate);
    const totals = await this.client.$queryRaw<Array<{ total: bigint; unit: string; updatedAt: Date }>>(Prisma.sql`
      SELECT total, unit, updated_at AS updatedAt
      FROM subscriber_total_snapshot WHERE stat_date = ${date} LIMIT 1
    `);
    const provinces = await this.client.$queryRaw<Array<{ adcode: string; name: string; value: bigint; unit: string }>>(Prisma.sql`
      SELECT adcode, province_name AS name, subscriber_count AS value, unit
      FROM subscriber_province_snapshot WHERE stat_date = ${date} ORDER BY adcode
    `);
    return {
      total: numeric(totals[0]?.total),
      unit: totals[0]?.unit ?? provinces[0]?.unit ?? '户',
      date,
      provinces: provinces.map((row) => ({ ...row, value: numeric(row.value) })),
      updatedAt: isoTime(totals[0]?.updatedAt),
    };
  }

  async getChangeSummary(window: ChangeWindow) {
    const rows = await this.client.$queryRaw<Array<{ statDate: Date | string; status: string; count: number }>>(Prisma.sql`
      SELECT stat_date AS statDate, status_key AS status, operation_count AS count
      FROM change_operation_snapshot
      WHERE window_key = ${window}
        AND stat_date = (SELECT MAX(stat_date) FROM change_operation_snapshot WHERE window_key = ${window})
      ORDER BY status_key
    `);
    const counts = new Map(rows.map((row) => [row.status, numeric(row.count)]));
    const success = counts.get('success') ?? 0;
    const cancelled = counts.get('cancelled') ?? 0;
    const rolledBack = counts.get('rolled_back') ?? 0;
    const unfinished = counts.get('unfinished') ?? 0;
    return {
      window,
      label: window === ChangeWindow.PAST_7D ? '过去 7 天' : '未来 7 天',
      total: success + cancelled + rolledBack + unfinished,
      success,
      cancelled,
      rolledBack,
      unfinished,
      updatedAt: dateSnapshotTime(rows[0]?.statDate),
    };
  }

  async getCapacitySummary() {
    const rows = await this.client.$queryRaw<Array<{
      total: number;
      normal: number;
      exceeded: number;
      unit: string;
      updatedAt: Date;
      statDate: Date | string;
    }>>(Prisma.sql`
      SELECT stat_date AS statDate, total_nodes AS total, normal_nodes AS normal,
             exceeded_nodes AS exceeded, unit, updated_at AS updatedAt
      FROM capacity_snapshot ORDER BY stat_date DESC LIMIT 1
    `);
    const row = rows[0];
    return {
      total: numeric(row?.total),
      normal: numeric(row?.normal),
      exceeded: numeric(row?.exceeded),
      unit: row?.unit ?? '个',
      updatedAt: isoTime(row?.updatedAt) ?? dateSnapshotTime(row?.statDate),
    };
  }

  async getNetworkScale(category: NetworkScaleCategory) {
    const summaries = await this.client.$queryRaw<Array<{
      statDate: Date | string;
      total: number;
      changeFromPreviousDay: number;
      unit: string;
    }>>(Prisma.sql`
      SELECT stat_date AS statDate, total_count AS total,
             added_from_previous_day AS changeFromPreviousDay, unit
      FROM network_scale_summary_snapshot
      WHERE category_key = ${category}
      ORDER BY stat_date DESC LIMIT 1
    `);
    const summary = summaries[0];
    if (!summary) return { category, total: 0, unit: '个', items: [], changeFromPreviousDay: 0, updatedAt: null };
    const items = await this.client.$queryRaw<Array<{
      itemKey: string;
      name: string;
      count: number;
      added: number;
    }>>(Prisma.sql`
      SELECT item_key AS itemKey, item_name AS name,
             item_count AS count, added_count AS added
      FROM network_scale_item_snapshot
      WHERE stat_date = ${dateOnly(summary.statDate)} AND category_key = ${category}
      ORDER BY item_key
    `);
    return {
      category,
      total: numeric(summary.total),
      unit: summary.unit,
      items: items.map((item) => ({ key: item.itemKey, name: item.name, count: numeric(item.count), added: numeric(item.added) })),
      changeFromPreviousDay: numeric(summary.changeFromPreviousDay),
      updatedAt: dateSnapshotTime(summary.statDate),
    };
  }

  async getSplitRatio(query: SplitRatioQueryDto) {
    const nationalDates = query.date
      ? [{ statDate: query.date }]
      : await this.client.$queryRaw<DateRow[]>(Prisma.sql`
          SELECT MAX(stat_date) AS statDate FROM split_ratio_snapshot WHERE adcode = '000000'
        `);
    const statDate = nationalDates[0]?.statDate;
    if (!statDate) return { date: query.date ?? null, national: 0, unit: '%', provinces: [], updatedAt: null };
    const date = dateOnly(statDate);
    const order = query.order === SortOrder.ASC ? Prisma.raw('ASC') : Prisma.raw('DESC');
    const rows = await this.client.$queryRaw<Array<{
      adcode: string;
      name: string;
      value: number | Prisma.Decimal;
    }>>(Prisma.sql`
      SELECT adcode, region_name AS name, split_ratio AS value
      FROM split_ratio_snapshot
      WHERE stat_date = ${date}
      ORDER BY CASE WHEN adcode = '000000' THEN 0 ELSE 1 END,
               split_ratio ${order}, adcode ASC
    `);
    const national = rows.find((row) => row.adcode === '000000');
    return {
      date,
      national: numeric(national?.value),
      unit: '%',
      provinces: rows.filter((row) => row.adcode !== '000000').slice(0, query.limit)
        .map((row) => ({ adcode: row.adcode, name: row.name, value: numeric(row.value) })),
      updatedAt: dateSnapshotTime(statDate),
    };
  }

  async getCapabilities(query: CapabilityQueryDto) {
    if (query.from && query.to && new Date(query.from) > new Date(query.to)) {
      throw new BadRequestException('from 不能晚于 to');
    }
    const filters: Prisma.Sql[] = [];
    if (query.from) filters.push(Prisma.sql`AND stat_date >= ${query.from.slice(0, 10)}`);
    if (query.to) filters.push(Prisma.sql`AND stat_date <= ${query.to.slice(0, 10)}`);
    if (!query.from && !query.to) {
      filters.push(Prisma.sql`AND stat_date = (
        SELECT MAX(latest.stat_date) FROM capability_usage_snapshot AS latest
        WHERE latest.category_key = ${query.category}
      )`);
    }
    const range = filters.length ? Prisma.join(filters, ' ') : Prisma.empty;
    const rows = await this.client.$queryRaw<Array<{
      statDate: Date | string;
      itemKey: string;
      name: string;
      count: bigint;
      unit: string;
    }>>(Prisma.sql`
      SELECT MAX(stat_date) AS statDate, item_key AS itemKey,
             item_name AS name, SUM(call_count) AS count, unit
      FROM capability_usage_snapshot
      WHERE category_key = ${query.category} ${range}
      GROUP BY item_key, item_name, unit
      ORDER BY item_key
    `);
    const total = rows.reduce((sum, row) => sum + numeric(row.count), 0);
    return {
      category: query.category,
      total,
      unit: rows[0]?.unit ?? '次',
      items: rows.map((row) => ({ key: row.itemKey, name: row.name, count: numeric(row.count) })),
      updatedAt: dateSnapshotTime(rows[0]?.statDate),
    };
  }

  private async latestDate(table: 'ticket_status_snapshot' | 'health_score_snapshot') {
    const rows = await this.client.$queryRaw<DateRow[]>(Prisma.raw(
      `SELECT MAX(stat_date) AS statDate FROM ${table}`,
    ));
    return rows[0]?.statDate ?? null;
  }
}
