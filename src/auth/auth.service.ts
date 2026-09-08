import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { PrismaService } from '../prisma/prisma.service';

// Node.js 原生 scrypt 使用回调，这里转换为 Promise，方便使用 await。
const scrypt = promisify(scryptCallback);

// 注册接口需要接收的三个字段。
export type RegisterInput = {
  email: string;
  password: string;
  displayName: string;
};

// 可以安全返回给前端的用户资料，故意不包含 passwordHash。
export type PublicUser = {
  id: string;
  email: string;
  displayName: string;
  createdAt: Date;
};

@Injectable()
export class AuthService {
  // PrismaService 由 NestJS 注入，负责读写 users 表。
  constructor(private readonly prisma: PrismaService) {}

  async register(input: RegisterInput): Promise<PublicUser> {
    // TypeScript 类型在运行时不存在，所以仍需检查真实请求中的字段类型。
    // 邮箱统一转成小写，避免同一邮箱因大小写不同而重复注册。
    const email =
      typeof input?.email === 'string'
        ? input.email.trim().toLowerCase()
        : '';
    const password =
      typeof input?.password === 'string' ? input.password : '';
    const displayName =
      typeof input?.displayName === 'string'
        ? input.displayName.trim()
        : '';

    if (!email || !email.includes('@')) {
      throw new BadRequestException('请输入有效的邮箱');
    }

    if (!password || password.length < 8) {
      throw new BadRequestException('密码至少需要 8 位');
    }

    if (!displayName || displayName.length > 50) {
      throw new BadRequestException('显示名称长度必须为 1 到 50 个字符');
    }

    // 数据库只保存密码摘要，不保存用户输入的原始密码。
    const passwordHash = await this.hashPassword(password);

    try {
      // select 明确限制返回字段，防止 passwordHash 被意外返回给前端。
      return await this.prisma.user.create({
        data: {
          email,
          passwordHash,
          displayName,
        },
        select: {
          id: true,
          email: true,
          displayName: true,
          createdAt: true,
        },
      });
    } catch (error: unknown) {
      // Prisma 的 P2002 表示唯一约束冲突，这里对应 email 已存在。
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('该邮箱已经注册');
      }

      throw error;
    }
  }

  private async hashPassword(password: string): Promise<string> {
    // 每位用户使用独立的随机 salt，让相同密码也产生不同摘要。
    const salt = randomBytes(16).toString('hex');
    // scrypt 会故意消耗一定 CPU 和内存，提高离线暴力破解成本。
    const derivedKey = (await scrypt(password, salt, 64)) as Buffer;

    // 登录校验时需要取出 salt 重新计算，因此 salt 和摘要一起保存。
    return `${salt}:${derivedKey.toString('hex')}`;
  }

  private isUniqueConstraintError(error: unknown): boolean {
    // error 是 unknown，读取 code 前必须先确认它确实是一个对象。
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }
}
