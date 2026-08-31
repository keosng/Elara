import { Injectable } from '@nestjs/common';

@Injectable()
export class ChatService {
  private histories = new Map<string, any[]>();//所有会话和用户,ai对话都存这里

//获取某个会话历史 如果没有就创建一个
private getHistory(conversationId: string): any[] {
  let history = this.histories.get(conversationId);

  if (!history) {
    history = [];
    this.histories.set(conversationId, history);
  }

  return history;
}
//删除一个传进来的指定的会话
deleteHistory(conversationId: string): boolean {
  return this.histories.delete(conversationId);
}

  private async callModel(messages: any[], temperature?: number): Promise<string> {
    // 调用AI模型,给ai模型发请求包 私有方法
    const response = await fetch(`${process.env.BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.MODEL,
        messages: messages,
        ...(temperature !== undefined && { temperature }) // 可选参数
      })
    });

    if (!response.ok) {
      throw new Error(`API 请求失败: HTTP ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  //判断是否要压缩上下文 以及把用户每句话放进数组里
  private async updateHistory(
    conversationId: string,
    userMessage: string,
    assistantResponse: string,
    onSystemMessage?: (message: string) => void,
  ): Promise<void> {
    const history = this.getHistory(conversationId);

    history.push({ role: 'user', content: userMessage });
    history.push({ role: 'assistant', content: assistantResponse });

    if (history.length > 20) {
    const summary = await this.summarizeHistory(history);
    const recentMessages = history.slice(-4);

    this.histories.set(conversationId, [
        { role: 'system', content: `对话摘要：${summary}` },
      ...recentMessages,
    ]);
    const systemMessage = '（系统已自动压缩历史上下文）';

    console.log(systemMessage);
    onSystemMessage?.(systemMessage);
    }
  }
  
  //组装上下文并请求ai
  async askAI(
    conversationId: string,
    userMessage: string,
  ): Promise<string> {
    const history = this.getHistory(conversationId);
    const messages = [
      ...history,
      { role: 'user', content: userMessage },
    ];
    return this.callModel(messages);
  }

  async summarizeHistory(messages: any[]): Promise<string> {
    //仅做一件事压缩上下文,需要时才会被updateHistory调用
    const summaryPrompt = [
      { role: 'system', content: '请总结以下对话的关键信息，包括用户的名字、重要事实、当前目标等。尽量简洁，不超过200字。' },
      ...messages,
    ];

    return this.callModel(summaryPrompt, 0.3);
  }

  //非流式聊天入口
  async getAIResponse(
    conversationId: string,
    userMessage: string,
  ): Promise<string> {
    const answer = await this.askAI(conversationId, userMessage);

    await this.updateHistory(
      conversationId,
      userMessage,
      answer,
    );

    return answer;
  }

  //流式聊天入口
  async streamAIResponse(
    conversationId: string,
    userMessage: string,
    onChunk: (chunk: string) => void,
    onSystemMessage?: (message: string) => void,
  ): Promise<void> {
    //流式输出 主要前端输出手段
    // 构造消息数组：历史消息 + 当前用户消息
    console.log(
      'streamAIResponse 被调用，会话 ID:',
      conversationId,
      '用户消息:',
      userMessage,
    );

    const history = this.getHistory(conversationId);

    const messages = [
      ...history,
      { role: 'user', content: userMessage },
    ];
  
    // 调用大模型 API，开启流式
    const response = await fetch(`${process.env.BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.MODEL,
        messages: messages,
        stream: true,          // 开启流式
        temperature: 0.7
      })
    });
    
    
  
    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
  
    // 获取可读流的读取器
    const reader = response.body.getReader();
    //二进制数据（字节）解码为字符串
    const decoder = new TextDecoder();
    let buffer = '';   // 用于暂存不完整的数据
    let fullAnswer = '';
  
    while (true) {
      
      const { done, value } = await reader.read();  // 读取一块数据
      
      if (done) break;  // 如果没有更多数据，退出循环
  
      // 将二进制数据转换为字符串，并追加到缓冲区
      buffer += decoder.decode(value, { stream: true });
  
      // SSE 数据按行分隔，每行以 "data: " 开头，以 "\n\n" 结尾
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // 最后一行可能不完整，留到下次处理
  
      for (const line of lines) {
        const trimmed = line.trim();
        
        if (trimmed.startsWith('data:')) {
          const jsonStr = trimmed.slice(5).trim(); // 去掉 "data:" 前缀
          if (jsonStr === '[DONE]') continue;      // 结束标记
          try {
            const json = JSON.parse(jsonStr);
            const delta = json.choices?.[0]?.delta?.content; // 获取增量文本
            if (delta) {
              onChunk(delta); // 通过回调将增量文本发送出去
              fullAnswer += delta;
            }
          } catch (e) {
            // 忽略解析错误，继续处理下一行
          }
        }
      }
    }
    await this.updateHistory(
      conversationId,
      userMessage,
      fullAnswer,
      onSystemMessage,
    );  // 使用公共方法
    
  }


}
