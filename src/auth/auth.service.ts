import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
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

export type LoginInput = {
  email: string;
  password: string;
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
    /**
     * 调用者：AuthController.register（POST /api/auth/register）。
     * 调用顺序：规范化字段 → 校验邮箱/密码/名称 → hashPassword →
     * PrismaService.user.create → 只返回公开字段。
     * P2002 由 isUniqueConstraintError 转成 ConflictException；其他数据库错误继续向 Controller 抛出。
     */
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

    if (!displayName || displayName.length > 8) {
      throw new BadRequestException('显示名称长度必须为 1 到 8 个字符');
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

  async login(input: LoginInput): Promise<PublicUser> {
    /**
     * 调用者：AuthController.login（POST /api/auth/login）。
     * 调用顺序：规范化邮箱 → User.findUnique 读取 passwordHash → verifyPassword 重新计算摘要 →
     * 删除 passwordHash 后返回公开用户资料。任何输入错误、用户不存在或密码不匹配都统一抛出 UnauthorizedException，
     * 避免通过错误信息泄露“邮箱是否存在”。Session 的创建由 Controller 在本方法成功后负责。
     */
    const email =
      typeof input?.email === 'string'
        ? input.email.trim().toLowerCase()
        : '';
    const password = typeof input?.password === 'string' ? input.password : '';

    if (!email || !email.includes('@') || !password) {
      throw new UnauthorizedException('邮箱或密码错误');
    }

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        displayName: true,
        createdAt: true,
      },
    });

    if (!user || !(await this.verifyPassword(password, user.passwordHash))) {
      throw new UnauthorizedException('邮箱或密码错误');
    }

    const { passwordHash: _passwordHash, ...publicUser } = user;
    return publicUser;
  }

  async getPublicUser(userId: string): Promise<PublicUser | null> {
    /**
     * 调用者：AuthController.me。只在 SessionAuthGuard 已确认 userId 后调用，
     * 通过 userId 查询公开字段；返回 null 时由 Controller 转成登录状态失效错误。
     */
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, displayName: true, createdAt: true },
    });
  }

  private async hashPassword(password: string): Promise<string> {
    /**
     * 调用者：register。生成独立 salt 后调用 Node.js scrypt，返回“salt:摘要”字符串，
     * 供后续 verifyPassword 从同一字符串拆出 salt 重新验证。
     */
    // 每位用户使用独立的随机 salt，让相同密码也产生不同摘要。
    const salt = randomBytes(16).toString('hex');
    // scrypt 会故意消耗一定 CPU 和内存，提高离线暴力破解成本。
    const derivedKey = (await scrypt(password, salt, 64)) as Buffer;

    // 登录校验时需要取出 salt 重新计算，因此 salt 和摘要一起保存。
    return `${salt}:${derivedKey.toString('hex')}`;
  }

  private async verifyPassword(
    password: string,
    storedHash: string,
  ): Promise<boolean> {
    /**
     * 调用者：login。拆分数据库中的“salt:摘要”，用相同参数重新运行 scrypt，
     * 再用 timingSafeEqual 比较；格式错误或长度不一致直接返回 false，不向外暴露存储细节。
     */
    const [salt, hashHex] = storedHash.split(':');
    if (!salt || !hashHex || !/^[0-9a-f]+$/i.test(hashHex)) return false;

    const derivedKey = (await scrypt(password, salt, hashHex.length / 2)) as Buffer;
    const expected = Buffer.from(hashHex, 'hex');
    return derivedKey.length === expected.length && timingSafeEqual(derivedKey, expected);
  }

  private isUniqueConstraintError(error: unknown): boolean {
    /**
     * 调用者：register 的 catch 分支。只识别 Prisma P2002 唯一约束错误，
     * 让邮箱重复变成可理解的 ConflictException，其他异常仍保持原错误继续上抛。
     */
    // error 是 unknown，读取 code 前必须先确认它确实是一个对象。
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }
}
