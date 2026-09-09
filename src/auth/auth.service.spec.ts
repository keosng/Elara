import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

const scrypt = promisify(scryptCallback);

describe('AuthService', () => {
  async function makePasswordHash(password: string) {
    const salt = randomBytes(16).toString('hex');
    const key = (await scrypt(password, salt, 64)) as Buffer;
    return `${salt}:${key.toString('hex')}`;
  }

  it('登录时会校验密码并只返回公开用户资料', async () => {
    const passwordHash = await makePasswordHash('correct horse battery staple');
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({
      id: 'user-1', email: 'alice@example.com', passwordHash,
      displayName: 'Alice', createdAt: new Date('2026-01-01T00:00:00.000Z'),
    }) } };
    const service = new AuthService(prisma as unknown as PrismaService);

    await expect(service.login({ email: ' Alice@Example.com ', password: 'correct horse battery staple' }))
      .resolves.toEqual({ id: 'user-1', email: 'alice@example.com', displayName: 'Alice', createdAt: new Date('2026-01-01T00:00:00.000Z') });
  });

  it('邮箱不存在或密码错误会返回未授权错误', async () => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(null) } };
    const service = new AuthService(prisma as unknown as PrismaService);
    await expect(service.login({ email: 'missing@example.com', password: 'password' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('注册时会规范化邮箱并只返回公开用户资料', async () => {
    const prisma = {
      user: {
        create: jest.fn().mockResolvedValue({
          id: 'user-1',
          email: 'alice@example.com',
          displayName: 'Alice',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      },
    };
    const service = new AuthService(prisma as unknown as PrismaService);

    const user = await service.register({
      email: ' Alice@Example.com ',
      password: 'correct horse battery staple',
      displayName: ' Alice ',
    });

    expect(user).toEqual({
      id: 'user-1',
      email: 'alice@example.com',
      displayName: 'Alice',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        email: 'alice@example.com',
        passwordHash: expect.stringMatching(/^[0-9a-f]+:[0-9a-f]+$/),
        displayName: 'Alice',
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        createdAt: true,
      },
    });
  });

  it('重复邮箱会转换为冲突错误', async () => {
    const prisma = {
      user: {
        create: jest.fn().mockRejectedValue({ code: 'P2002' }),
      },
    };
    const service = new AuthService(prisma as unknown as PrismaService);

    await expect(
      service.register({
        email: 'alice@example.com',
        password: 'correct horse battery staple',
        displayName: 'Alice',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('非法字段类型会返回参数错误', async () => {
    const prisma = { user: { create: jest.fn() } };
    const service = new AuthService(prisma as unknown as PrismaService);

    await expect(
      service.register({
        email: 123 as unknown as string,
        password: 'password',
        displayName: 'Alice',
      }),
    ).rejects.toThrow('请输入有效的邮箱');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});
