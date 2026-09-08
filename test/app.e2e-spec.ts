import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { ChatService } from './../src/chat/chat.service';
import { PrismaService } from './../src/prisma/prisma.service';
describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  const mockChatService = {
    getAIResponse: jest.fn(),
    deleteHistory: jest.fn(),
    createConversation: jest.fn(),
  };

  beforeEach(async () => {

    mockChatService.getAIResponse.mockReset();
    mockChatService.deleteHistory.mockReset();
    mockChatService.createConversation.mockReset();
    mockChatService.getAIResponse.mockResolvedValue('这是测试回答');
    mockChatService.createConversation.mockResolvedValue(
      '63110219-38e4-4fc5-bbf1-c1be23632b25',
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
    .overrideProvider(ChatService)
    .useValue(mockChatService)
    .overrideProvider(PrismaService)
    .useValue({})
    .compile();

    app = moduleFixture.createNestApplication();
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

  it('/api/chat/:conversationId (DELETE) 应该删除会话历史', async () => {
    mockChatService.deleteHistory.mockReturnValue(true);

    await request(app.getHttpServer())
      .delete('/api/chat/conversation-a')
      .expect(200)
      .expect({ deleted: true });

    expect(mockChatService.deleteHistory).toHaveBeenCalledWith(
      'conversation-a',
    );
  });

  afterEach(async () => {
    await app.close();
  });
});
