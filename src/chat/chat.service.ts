import { Injectable } from '@nestjs/common';

@Injectable()
export class ChatService {
  private history: any[] = [];

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


  private async updateHistory(userMessage: string, assistantResponse: string): Promise<void> {
    //私有方法，处理上下文保存记忆 ai有记忆核心
    this.history.push({ role: 'user', content: userMessage });
    this.history.push({ role: 'assistant', content: assistantResponse });
  
    if (this.history.length > 20) {
      const summary = await this.summarizeHistory(this.history);
      const recentMessages = this.history.slice(-4);
      this.history = [
        { role: 'system', content: `对话摘要：${summary}` },
        ...recentMessages
      ];
      console.log('（系统已自动压缩历史上下文）');
    }
  }
  

  async askAI(userMessage: string, history: any[] = this.history): Promise<string> {
    // 1. 构建消息列表,把用户的消息传进来
    const messages = [
      ...history,
      { role: 'user', content: userMessage }
    ];

    return this.callModel(messages);

    
  }

  async summarizeHistory(messages: any[]): Promise<string> {
    //ai上下文摘要判断
    const summaryPrompt = [
      { role: 'system', content: '请总结以下对话的关键信息，包括用户的名字、重要事实、当前目标等。尽量简洁，不超过200字。' },
      ...messages,
    ];

    return this.callModel(summaryPrompt, 0.3);
  }

  async getAIResponse(userMessage: string): Promise<string> {
    //非流式入调用了askAI和summarizeHistory
    // 1. 调用 AI 获取回复
    const answer = await this.askAI(userMessage, this.history);

    await this.updateHistory(userMessage, answer);
    // 2. 更新历史
    

    return answer;
  }

  async streamAIResponse(userMessage: string, onChunk: (chunk: string) => void): Promise<void> {
    //流式输出 主要前端输出手段
    // 构造消息数组：历史消息 + 当前用户消息
    console.log('streamAIResponse 被调用，用户消息:', userMessage);
    const messages = [
      ...this.history,
      { role: 'user', content: userMessage }
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
    await this.updateHistory(userMessage, fullAnswer);  // 使用公共方法
    
  }


}