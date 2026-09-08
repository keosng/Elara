import { ConflictException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuthService', () => {
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
