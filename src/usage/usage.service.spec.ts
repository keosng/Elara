import { PrismaService } from '../prisma/prisma.service';
import { UsageService } from './usage.service';

type PrismaMock = {
  aiUsageRecord: {
    create: jest.Mock;
  };
  userUsageSummary: {
    upsert: jest.Mock;
    findUnique: jest.Mock;
  };
  conversationUsageSummary: {
    upsert: jest.Mock;
    findMany: jest.Mock;
  };
  $transaction: jest.Mock;
};

describe('UsageService', () => {
  let service: UsageService;
  let prismaMock: PrismaMock;

  beforeEach(() => {
    prismaMock = {
      aiUsageRecord: {
        create: jest.fn().mockResolvedValue({}),
      },
      userUsageSummary: {
        upsert: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
      },
      conversationUsageSummary: {
        upsert: jest.fn().mockResolvedValue({}),
        findMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: PrismaMock) => Promise<void>) =>
        callback(prismaMock),
    );

    service = new UsageService(prismaMock as unknown as PrismaService);
  });

  it('应返回用户和会话 Token 汇总', async () => {
    prismaMock.userUsageSummary.findUnique.mockResolvedValue({
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      callCount: 2,
      unknownInputCallCount: 0,
      unknownOutputCallCount: 1,
    });
    prismaMock.conversationUsageSummary.findMany.mockResolvedValue([
      {
        conversationId: 'conversation-a',
        inputTokens: 80,
        outputTokens: 20,
        totalTokens: 100,
        callCount: 1,
        unknownInputCallCount: 0,
        unknownOutputCallCount: 0,
      },
    ]);

    await expect(service.getUsageOverview('user-a')).resolves.toEqual({
      user: {
        inputTokens: 120,
        outputTokens: 30,
        totalTokens: 150,
        callCount: 2,
        unknownInputCallCount: 0,
        unknownOutputCallCount: 1,
      },
      conversations: [
        {
          conversationId: 'conversation-a',
          inputTokens: 80,
          outputTokens: 20,
          totalTokens: 100,
          callCount: 1,
          unknownInputCallCount: 0,
          unknownOutputCallCount: 0,
        },
      ],
    });
    expect(prismaMock.userUsageSummary.findUnique).toHaveBeenCalledWith({
      where: {
        userId: 'user-a',
      },
      select: {
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        callCount: true,
        unknownInputCallCount: true,
        unknownOutputCallCount: true,
      },
    });
    expect(prismaMock.conversationUsageSummary.findMany).toHaveBeenCalledWith({
      where: {
        conversation: {
          userId: 'user-a',
          deletedAt: null,
        },
      },
      select: {
        conversationId: true,
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        callCount: true,
        unknownInputCallCount: true,
        unknownOutputCallCount: true,
      },
    });
  });

  it('没有汇总记录时应返回全零用量', async () => {
    prismaMock.userUsageSummary.findUnique.mockResolvedValue(null);
    prismaMock.conversationUsageSummary.findMany.mockResolvedValue([]);

    await expect(service.getUsageOverview('user-a')).resolves.toEqual({
      user: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        callCount: 0,
        unknownInputCallCount: 0,
        unknownOutputCallCount: 0,
      },
      conversations: [],
    });
  });

  it('应优先记录上游精确 usage，并累加用户和会话汇总', async () => {
    await service.record({
      userId: 'user-a',
      conversationId: 'conversation-a',
      messageId: 'message-a',
      requestType: 'STREAM',
      model: 'test-model',
      usage: {
        prompt_tokens: 700,
        completion_tokens: 16,
        total_tokens: 716,
      },
    });

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.aiUsageRecord.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-a',
        conversationId: 'conversation-a',
        messageId: 'message-a',
        requestType: 'STREAM',
        source: 'UPSTREAM',
        model: 'test-model',
        inputTokens: 700,
        outputTokens: 16,
        totalTokens: 716,
      },
    });
    expect(prismaMock.userUsageSummary.upsert).toHaveBeenCalledWith({
      where: {
        userId: 'user-a',
      },
      create: {
        userId: 'user-a',
        inputTokens: 700,
        outputTokens: 16,
        totalTokens: 716,
        callCount: 1,
        unknownInputCallCount: 0,
        unknownOutputCallCount: 0,
      },
      update: {
        inputTokens: {
          increment: 700,
        },
        outputTokens: {
          increment: 16,
        },
        totalTokens: {
          increment: 716,
        },
        callCount: {
          increment: 1,
        },
        unknownInputCallCount: {
          increment: 0,
        },
        unknownOutputCallCount: {
          increment: 0,
        },
      },
    });
    expect(prismaMock.conversationUsageSummary.upsert).toHaveBeenCalledWith({
      where: {
        conversationId: 'conversation-a',
      },
      create: {
        conversationId: 'conversation-a',
        inputTokens: 700,
        outputTokens: 16,
        totalTokens: 716,
        callCount: 1,
        unknownInputCallCount: 0,
        unknownOutputCallCount: 0,
      },
      update: {
        inputTokens: {
          increment: 700,
        },
        outputTokens: {
          increment: 16,
        },
        totalTokens: {
          increment: 716,
        },
        callCount: {
          increment: 1,
        },
        unknownInputCallCount: {
          increment: 0,
        },
        unknownOutputCallCount: {
          increment: 0,
        },
      },
    });
  });

  it('上游未返回 usage 时应记录估算值并累加汇总', async () => {
    await service.record({
      userId: 'user-a',
      conversationId: 'conversation-a',
      messageId: 'message-a',
      requestType: 'CHAT',
      model: 'test-model',
      estimateContext: {
        messages: [{ role: 'user', content: '你好，Elara。' }],
        outputText: '你好，我在这里。',
      },
    });

    expect(prismaMock.aiUsageRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-a',
        conversationId: 'conversation-a',
        messageId: 'message-a',
        requestType: 'CHAT',
        source: 'ESTIMATED',
        model: 'test-model',
        inputTokens: expect.any(Number),
        outputTokens: expect.any(Number),
        totalTokens: expect.any(Number),
      }),
    });
    expect(prismaMock.userUsageSummary.upsert).toHaveBeenCalledWith({
      where: {
        userId: 'user-a',
      },
      create: expect.objectContaining({
        userId: 'user-a',
        inputTokens: expect.any(Number),
        outputTokens: expect.any(Number),
        totalTokens: expect.any(Number),
        callCount: 1,
        unknownInputCallCount: 0,
        unknownOutputCallCount: 0,
      }),
      update: {
        inputTokens: {
          increment: expect.any(Number),
        },
        outputTokens: {
          increment: expect.any(Number),
        },
        totalTokens: {
          increment: expect.any(Number),
        },
        callCount: {
          increment: 1,
        },
        unknownInputCallCount: {
          increment: 0,
        },
        unknownOutputCallCount: {
          increment: 0,
        },
      },
    });
  });

  it('没有会话 ID 时只累加用户汇总', async () => {
    await service.record({
      userId: 'user-a',
      requestType: 'SUMMARY',
      model: 'test-model',
      usage: {
        prompt_tokens: 20,
        completion_tokens: 5,
        total_tokens: 25,
      },
    });

    expect(prismaMock.userUsageSummary.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.conversationUsageSummary.upsert).not.toHaveBeenCalled();
  });

  it('只有总量时直接累计总量，并记录输入输出未知', async () => {
    await service.record({
      userId: 'user-a',
      conversationId: 'conversation-a',
      requestType: 'STREAM',
      model: 'test-model',
      usage: {
        total_tokens: 100,
      },
    });

    expect(prismaMock.aiUsageRecord.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-a',
        conversationId: 'conversation-a',
        messageId: null,
        requestType: 'STREAM',
        source: 'UPSTREAM',
        model: 'test-model',
        inputTokens: null,
        outputTokens: null,
        totalTokens: 100,
      },
    });
    expect(prismaMock.userUsageSummary.upsert).toHaveBeenCalledWith({
      where: {
        userId: 'user-a',
      },
      create: {
        userId: 'user-a',
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 100,
        callCount: 1,
        unknownInputCallCount: 1,
        unknownOutputCallCount: 1,
      },
      update: {
        inputTokens: {
          increment: 0,
        },
        outputTokens: {
          increment: 0,
        },
        totalTokens: {
          increment: 100,
        },
        callCount: {
          increment: 1,
        },
        unknownInputCallCount: {
          increment: 1,
        },
        unknownOutputCallCount: {
          increment: 1,
        },
      },
    });
    expect(prismaMock.conversationUsageSummary.upsert).toHaveBeenCalledWith({
      where: {
        conversationId: 'conversation-a',
      },
      create: {
        conversationId: 'conversation-a',
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 100,
        callCount: 1,
        unknownInputCallCount: 1,
        unknownOutputCallCount: 1,
      },
      update: {
        inputTokens: {
          increment: 0,
        },
        outputTokens: {
          increment: 0,
        },
        totalTokens: {
          increment: 100,
        },
        callCount: {
          increment: 1,
        },
        unknownInputCallCount: {
          increment: 1,
        },
        unknownOutputCallCount: {
          increment: 1,
        },
      },
    });
  });

  it('没有总量但输入输出都存在时应相加得到总量', async () => {
    await service.record({
      userId: 'user-a',
      requestType: 'CHAT',
      model: 'test-model',
      usage: {
        prompt_tokens: 20,
        completion_tokens: 5,
      },
    });

    expect(prismaMock.aiUsageRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        source: 'UPSTREAM',
        inputTokens: 20,
        outputTokens: 5,
        totalTokens: 25,
      }),
    });
  });

  it('只缺少部分字段时应保留上游值，并将来源标记为 PARTIAL', async () => {
    await service.record({
      userId: 'user-a',
      requestType: 'CHAT',
      model: 'test-model',
      usage: {
        prompt_tokens: 20,
      },
      estimateContext: {
        messages: [{ role: 'user', content: '你好，Elara。' }],
        outputText: '你好，我在这里。',
      },
    });

    expect(prismaMock.aiUsageRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        source: 'PARTIAL',
        inputTokens: 20,
        outputTokens: expect.any(Number),
        totalTokens: expect.any(Number),
      }),
    });
  });
});
