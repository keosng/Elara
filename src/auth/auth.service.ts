import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { PrismaService } from '../prisma/prisma.service';

const scrypt = promisify(scryptCallback);

export type RegisterInput = {
  email: string;
  password: string;
  displayName: string;
};

export type PublicUser = {
  id: string;
  email: string;
  displayName: string;
  createdAt: Date;
};

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async register(input: RegisterInput): Promise<PublicUser> {
    const email = input.email?.trim().toLowerCase();
    const password = input.password;
    const displayName = input.displayName?.trim();

    if (!email || !email.includes('@')) {
      throw new BadRequestException('请输入有效的邮箱');
    }

    if (!password || password.length < 8) {
      throw new BadRequestException('密码至少需要 8 位');
    }

    if (!displayName || displayName.length > 50) {
      throw new BadRequestException('显示名称长度必须为 1 到 50 个字符');
    }

    const passwordHash = await this.hashPassword(password);

    try {
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
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('该邮箱已经注册');
      }

      throw error;
    }
  }

  private async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const derivedKey = (await scrypt(password, salt, 64)) as Buffer;

    return `${salt}:${derivedKey.toString('hex')}`;
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }
}
