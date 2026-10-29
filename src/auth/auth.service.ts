import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import type { JwtPayload } from './interfaces/jwt-payload.interface';

const MAX_LOGIN_ERRORS = 5;
const LOCK_MINUTES = 15;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(dto: LoginDto, ip: string) {
    const db = this.prisma.getClient('devices');
    const user = await db.sysUser.findUnique({ where: { username: dto.username } });
    if (!user || user.deleteFlag !== 0) throw new UnauthorizedException('用户名或密码错误');
    if (user.status !== 1) throw new UnauthorizedException('账号已禁用');
    if (user.lockTime && user.lockTime > new Date()) throw new UnauthorizedException('账号已锁定，请稍后再试');

    const passwordMatches = await bcrypt.compare(dto.password, user.password);
    if (!passwordMatches) {
      await db.$executeRaw(Prisma.sql`
        UPDATE sys_user
        SET lock_time = CASE
              WHEN error_count >= ${MAX_LOGIN_ERRORS - 1}
                THEN DATE_ADD(NOW(3), INTERVAL ${LOCK_MINUTES} MINUTE)
              ELSE lock_time
            END,
            error_count = error_count + 1
        WHERE id = ${user.id} AND delete_flag = 0 AND status = 1
      `);
      throw new UnauthorizedException('用户名或密码错误');
    }

    await db.sysUser.update({
      where: { id: user.id },
      data: { errorCount: 0, lockTime: null, lastLoginTime: new Date(), lastLoginIp: ip || null },
    });
    const payload: JwtPayload = { sub: user.id, username: user.username };
    const accessToken = await this.jwt.signAsync(payload);
    return { accessToken, tokenType: 'Bearer', expiresIn: this.config.get<string>('JWT_EXPIRES_IN', '2h') };
  }

  async getProfile(userId: number) {
    const user = await this.prisma.getClient('devices').sysUser.findUnique({
      where: { id: userId },
      select: { id: true, username: true, nickname: true, status: true, lastLoginTime: true, lastLoginIp: true },
    });
    if (!user || user.status !== 1) throw new UnauthorizedException('账号不可用');
    return user;
  }
}
