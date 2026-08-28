import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { ChatService } from './../src/chat/chat.service';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  const mockChatService = {
    getAIResponse: jest.fn(),
  };

  beforeEach(async () => {
    mockChatService.getAIResponse.mockResolvedValue('这是测试回答');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ChatService)
      .useValue(mockChatService)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/api/chat (POST) 应该返回 AI 回复', () => {
    return request(app.getHttpServer())
      .post('/api/chat')
      .send({ message: '你好' })
      .expect(201)
      .expect({ answer: '这是测试回答' });
  });

  afterEach(async () => {
    await app.close();
  });
});
