import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { ChatService } from './../src/chat/chat.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { SessionAuthGuard } from './../src/auth/session-auth.guard';
import { UsageService } from './../src/usage/usage.service';
describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  const mockChatService = {
    getAIResponse: jest.fn(),
    deleteHistory: jest.fn(),
    createConversation: jest.fn(),
  };
  const mockUsageService = {
    getUsageOverview: jest.fn(),
  };

  beforeEach(async () => {
    mockChatService.getAIResponse.mockReset();
    mockChatService.deleteHistory.mockReset();
    mockChatService.createConversation.mockReset();
    mockChatService.getAIResponse.mockResolvedValue('这是测试回答');
    mockChatService.createConversation.mockResolvedValue(
      '63110219-38e4-4fc5-bbf1-c1be23632b25',
    );
    mockUsageService.getUsageOverview.mockReset();
    mockUsageService.getUsageOverview.mockResolvedValue({
      user: {
        inputTokens: 120,
        outputTokens: 30,
        totalTokens: 150,
        callCount: 2,
        unknownInputCallCount: 0,
        unknownOutputCallCount: 0,
      },
      conversations: [],
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ChatService)
      .useValue(mockChatService)
      .overrideProvider(UsageService)
      .useValue(mockUsageService)
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideGuard(SessionAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    app.use((request, _response, next) => {
      request.session = { userId: 'test-user-id' } as typeof request.session;
      next();
    });
    await app.init();
  });

  it('/api/chat (POST) 应该返回 AI 回复', () => {
    return request(app.getHttpServer())
      .post('/api/chat')
      .send({
        conversationId: 'conversation-a',
        message: '你好',
      })
      .expect(201)
      .expect({ answer: '这是测试回答' });
  });

  it('/api/conversations (POST) 应该创建会话', () => {
    return request(app.getHttpServer())
      .post('/api/conversations')
      .expect(201)
      .expect({
        conversationId: '63110219-38e4-4fc5-bbf1-c1be23632b25',
      });
  });

  it('/api/usage (GET) 应该返回当前用户用量概览', () => {
    return request(app.getHttpServer())
      .get('/api/usage')
      .expect(200)
      .expect({
        user: {
          inputTokens: 120,
          outputTokens: 30,
          totalTokens: 150,
          callCount: 2,
          unknownInputCallCount: 0,
          unknownOutputCallCount: 0,
        },
        conversations: [],
      });
  });

  it('/api/chat/:conversationId (DELETE) 应该删除会话历史', async () => {
    mockChatService.deleteHistory.mockReturnValue(true);

    await request(app.getHttpServer())
      .delete('/api/chat/conversation-a')
      .expect(200)
      .expect({ deleted: true });

    expect(mockChatService.deleteHistory).toHaveBeenCalledWith(
      'conversation-a',
      'test-user-id',
    );
  });

  afterEach(async () => {
    await app.close();
  });
});
