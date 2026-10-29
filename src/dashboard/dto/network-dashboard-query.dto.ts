import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export enum ChangeWindow {
  PAST_7D = 'past7d',
  NEXT_7D = 'next7d',
}

export enum NetworkScaleCategory {
  ELEMENT = 'element',
  DEVICE = 'device',
  SERVER = 'server',
}

export enum CapabilityCategory {
  INTERFACE = 'interface',
  SYSTEM = 'system',
}

export class RankingQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 8;

  @IsOptional()
  @IsEnum(SortOrder)
  order: SortOrder = SortOrder.DESC;
}

export class DateQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  date?: string;
}

export class ChangeSummaryQueryDto {
  @IsEnum(ChangeWindow)
  window!: ChangeWindow;
}

export class NetworkScaleQueryDto {
  @IsEnum(NetworkScaleCategory)
  category!: NetworkScaleCategory;
}

export class SplitRatioQueryDto extends DateQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 8;

  @IsOptional()
  @IsEnum(SortOrder)
  order: SortOrder = SortOrder.DESC;
}

export class CapabilityQueryDto {
  @IsEnum(CapabilityCategory)
  category!: CapabilityCategory;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
