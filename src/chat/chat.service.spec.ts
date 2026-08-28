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
});