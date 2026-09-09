import { ChatService } from './chat.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

describe('ChatService', () => {
  let service: ChatService;
  let fetchMock: jest.Spied<typeof fetch>;

  type PrismaMock = {
    $transaction: jest.Mock;
    message: {
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    conversation: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
    },
    conversationSummary: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
    };
  };

  type StoredMessage = {
    id: string;
    conversationId: string;
    sequence: number;
    role: string;
    status: 'PENDING' | 'COMPLETED' | 'FAILED';
    content: string;
  };

  type CreateArgs = {
    data: {
      conversationId: string;
      role: string;
      status: 'PENDING' | 'COMPLETED' | 'FAILED';
      content: string;
    };
  };

  type FindManyArgs = {
    where: {
      conversationId: string;
      status?: 'PENDING' | 'COMPLETED' | 'FAILED';
      sequence?: {
        gt?: number;
      };
    };
    select?: {
      sequence?: boolean;
      role?: boolean;
      content?: boolean;
    };
  };

  let prismaMock: PrismaMock;
  beforeEach(() => {
    const storedMessages: StoredMessage[] = [];
    let nextSequence = 1;
    let nextMessageId = 1;
    prismaMock = {
      $transaction: jest.fn(),

      message: {
        findMany: jest.fn().mockImplementation(
          async ({ where, select }: FindManyArgs) => {
            const minSequence = where.sequence?.gt;

            return storedMessages
              .filter((message) => {
                const sameConversation =
                  message.conversationId === where.conversationId;

                const afterSummary =
                  minSequence === undefined ||
                  message.sequence > minSequence;

                const matchingStatus =
                  where.status === undefined ||
                  message.status === where.status;

                return sameConversation && afterSummary && matchingStatus;
              })
              .sort((a, b) => a.sequence - b.sequence)
              .map((message) => {
                if (select?.sequence) {
                  return {
                    sequence: message.sequence,
                    role: message.role,
                    content: message.content,
                  };
                }

                return {
                  role: message.role,
                  content: message.content,
                };
              });
          },
        ),
        create: jest.fn().mockImplementation(
          async ({ data }: CreateArgs) => {
            const message = {
              id: `message-${nextMessageId}`,
              ...data,
              sequence: nextSequence,
            };

            nextMessageId += 1;
            nextSequence += 1;
            storedMessages.push(message);

            return message;
          },
        ),
        update: jest.fn().mockImplementation(
          async ({ where, data }) => {
            const message = storedMessages.find(
              (item) => item.id === where.id,
            );

            if (!message) {
              throw new Error('测试消息不存在');
            }

            Object.assign(message, data);
            return message;
          },
        ),
      },
      conversation: {
        findUnique: jest.fn().mockResolvedValue({
          title: '新会话',
        }),
        findFirst: jest.fn().mockResolvedValue({
          title: '新会话',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      conversationSummary: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };

    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: PrismaMock) => Promise<unknown>) =>
        callback(prismaMock),
    );

    const configMock = {
      getOrThrow: jest.fn((key: string) => {
        const values: Record<string, string> = {
          BASE_URL: 'https://api.example.com',
          API_KEY: 'test-api-key',
          MODEL: 'test-model',
          DEV_USER_ID: 'test-user-id',
        };

        return values[key];
      }),
    };

    service = new ChatService(
      prismaMock as unknown as PrismaService,
      configMock as unknown as ConfigService,
    );
    //类型是fetch,然后被jest监视
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('应该返回 AI 回复', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '这是测试回答',
            },
          },
        ],
      }),
    } as Response);

    const answer = await service.getAIResponse(
      'conversation-a',
      '你好',
    );

    expect(answer).toBe('这是测试回答');
  });

  it('不同会话的历史应该互不影响', async () => {
    const createResponse = (content: string) =>
      ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content,
              },
            },
          ],
        }),
      }) as Response;

    fetchMock
      .mockResolvedValueOnce(createResponse('A 的第一次回答'))
      .mockResolvedValueOnce(createResponse('B 的第一次回答'))
      .mockResolvedValueOnce(createResponse('A 的第二次回答'));

    await service.getAIResponse('conversation-a', '我叫小明');
    await service.getAIResponse('conversation-b', '我叫小红');
    await service.getAIResponse('conversation-a', '你还记得我吗？');

    const thirdRequest = fetchMock.mock.calls[2][1];
    const requestBody = JSON.parse(thirdRequest?.body as string);

    expect(requestBody.messages).toEqual([
      { role: 'user', content: '我叫小明' },
      { role: 'assistant', content: 'A 的第一次回答' },
      { role: 'user', content: '你还记得我吗？' },
    ]);
  });

  it('软删除会话后会写入删除时间', async () => {
    const deleted = await service.deleteHistory(
      'conversation-delete',
    );

    expect(deleted).toBe(true);

    expect(prismaMock.conversation.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'conversation-delete',
        deletedAt: null,
      },
      data: {
        deletedAt: expect.any(Date),
      },
    });
  });

  it('删除不存在的会话时返回 false', async () => {
    prismaMock.conversation.updateMany.mockResolvedValue({
      count: 0,
    });

    const deleted = await service.deleteHistory(
      'conversation-not-found',
    );

    expect(deleted).toBe(false);
  });
});
