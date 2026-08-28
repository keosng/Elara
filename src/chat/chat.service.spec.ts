import { ChatService } from './chat.service';

describe('ChatService', () => {
  let service: ChatService;
  let fetchMock: jest.Spied<typeof fetch>;

  beforeEach(() => {
    service = new ChatService();
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

    const answer = await service.getAIResponse('你好');

    expect(answer).toBe('这是测试回答');
  });
});