import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}


  // ==================== 对外会话接口 ====================

  // 创建一个新会话，并返回会话 UUID
  async createConversation(): Promise<string> {
    const userId = this.configService.getOrThrow<string>('DEV_USER_ID');


    const conversation = await this.prisma.conversation.create({
      data: {
        userId,
      },
    });

    return conversation.id;
  }

  // 查询所有未被软删除的会话，供前端刷新会话列表
  async getConversations() {
    return this.prisma.conversation.findMany({
      where: {
        deletedAt: null,
      },
      orderBy: {
        updatedAt: 'desc',
      },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  // 查询指定会话的消息，供前端恢复聊天记录
  async getConversationMessages(conversationId: string) {
    return this.prisma.message.findMany({
      where: {
        conversationId,
        conversation: {
          deletedAt: null,
        },
      },
      orderBy: {
        sequence: 'asc',
      },
      select: {
        role: true,
        content: true,
        status: true,
        createdAt: true,
      },
    });
  }

  // 软删除指定会话
  async deleteHistory(conversationId: string): Promise<boolean> {
    const result = await this.prisma.conversation.updateMany({
      where: {
        id: conversationId,
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
      },
    });

    return result.count > 0;
  }

  // ==================== 对外聊天入口 ====================

  // 非流式聊天入口：协调消息、模型和摘要流程
  async getAIResponse(
    conversationId: string,
    userMessage: string,
  ): Promise<string> {
    return this.withConversationLock(
      conversationId,
      async () => {
        const assistantMessageId =
          await this.createPendingMessages(
            conversationId,
            userMessage,
          );

        try {
          const answer = await this.askAI(conversationId);

          await this.completePendingMessage(
            assistantMessageId,
            answer,
          );

          await this.updateHistory(conversationId);

          return answer;
        } catch (error) {
          await this.failPendingMessage(assistantMessageId);
          throw error;
        }
      },
    );
  }

  // 流式聊天入口：协调消息、流式模型和摘要流程
  async streamAIResponse(
    conversationId: string,
    userMessage: string,
    onChunk: (chunk: string) => void,
    onSystemMessage?: (message: string) => void,
  ): Promise<void> {
    return this.withConversationLock(
      conversationId,
      async () => {
        console.log(
          'streamAIResponse 被调用，会话 ID:',
          conversationId,
          '用户消息:',
          userMessage,
        );

        const assistantMessageId =
          await this.createPendingMessages(
            conversationId,
            userMessage,
          );

        try {
          const history = await this.getHistory(conversationId);

          const fullAnswer =
            await this.streamModelResponse(
              history,
              onChunk,
            );

          await this.completePendingMessage(
            assistantMessageId,
            fullAnswer,
          );

          await this.updateHistory(
            conversationId,
            onSystemMessage,
          );
        } catch (error) {
          await this.failPendingMessage(
            assistantMessageId,
          );

          throw error;
        }
      },
    );
  }

  // ==================== 任务并发控制 ====================

      // 正在生成 AI 回复的会话
  private readonly activeConversations = new Set<string>();

      // 给同一个会话加锁，保证同一时间只有一个 AI 任务
  private async withConversationLock<T>(
    conversationId: string,
    task: () => Promise<T>,
  ): Promise<T> {
    // 如果已经存在，说明这个会话正在生成回复
    if (this.activeConversations.has(conversationId)) {
      throw new Error('上一条回复仍在生成，请稍候');
    }

    // 开始执行前立即加锁
    this.activeConversations.add(conversationId);

    try {
      // 等待整轮任务执行完成
      return await task();
    } finally {
      // 无论成功还是失败，最后都释放锁
      this.activeConversations.delete(conversationId);
    }
  }

  // ==================== 模型调用方法 ====================

  // 查询已完成的历史消息，并调用非流式模型
  private async askAI(conversationId: string): Promise<string> {
    const history = await this.getHistory(conversationId);
    return this.callModel(history);
  }

  // 调用 AI 模型，等待完整响应后返回
  private async callModel(
    messages: { role: string; content: string }[],
    temperature?: number,
  ): Promise<string> {
    const baseUrl = this.configService.getOrThrow<string>('BASE_URL');
    const apiKey = this.configService.getOrThrow<string>('API_KEY');
    const model = this.configService.getOrThrow<string>('MODEL');

    
    const response = await fetch(
      `${baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          ...(temperature !== undefined ? { temperature } : {}),
        }),
      },
    );

    if (!response.ok) {
      throw new Error(
        `API 请求失败: HTTP ${response.status}: ${await response.text()}`,
      );
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  // 调用 AI 模型并解析流式响应，逐段交给 Controller
  private async streamModelResponse(
    messages: { role: string; content: string }[],
    onChunk: (chunk: string) => void,
  ): Promise<string> {
    const baseUrl = this.configService.getOrThrow<string>('BASE_URL');
    const apiKey = this.configService.getOrThrow<string>('API_KEY');
    const model = this.configService.getOrThrow<string>('MODEL');
    
    const response = await fetch(
      `${baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          temperature: 0.7,
        }),
      },
    );

    if (!response.ok || !response.body) {
      throw new Error(
        `HTTP ${response.status}: ${await response.text()}`,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullAnswer = '';

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed.startsWith('data:')) {
          continue;
        }

        const jsonStr = trimmed.slice(5).trim();

        if (jsonStr === '[DONE]') {
          continue;
        }

        try {
          const json = JSON.parse(jsonStr);
          const delta = json.choices?.[0]?.delta?.content;

          if (delta) {
            fullAnswer += delta;
            onChunk(delta);
          }
        } catch {
          // 不完整的 JSON 留到下一块数据继续处理
        }
      }
    }

    return fullAnswer;
  }

  // ==================== 消息持久化方法 ====================

  // 立即保存用户消息，并创建一条等待 AI 生成的消息
  private async createPendingMessages(
    conversationId: string,
    userMessage: string,
  ): Promise<string> {
    const assistantMessage = await this.prisma.$transaction(async (tx) => {
      await tx.message.create({
        data: {
          conversationId,
          role: 'user',
          status: 'COMPLETED',
          content: userMessage,
        },
      });

      const pendingMessage = await tx.message.create({
        data: {
          conversationId,
          role: 'assistant',
          status: 'PENDING',
          content: '',
        },
      });

      const conversation = await tx.conversation.findUnique({
        where: {
          id: conversationId,
        },
        select: {
          title: true,
        },
      });

      const title =
        userMessage.length > 28
          ? `${userMessage.slice(0, 28)}...`
          : userMessage;

      await tx.conversation.update({
        where: {
          id: conversationId,
        },
        data: {
          updatedAt: new Date(),
          ...(conversation?.title === '新会话' ? { title } : {}),
        },
      });

      return pendingMessage;
    });

    return assistantMessage.id;
  }

  // AI 生成完成后，更新原来的待生成消息
  private async completePendingMessage(
    messageId: string,
    assistantResponse: string,
  ): Promise<void> {
    await this.prisma.message.update({
      where: {
        id: messageId,
      },
      data: {
        content: assistantResponse,
        status: 'COMPLETED',
      },
    });
  }

  // AI 生成失败后，更新原来的待生成消息
  private async failPendingMessage(messageId: string): Promise<void> {
    await this.prisma.message.update({
      where: {
        id: messageId,
      },
      data: {
        status: 'FAILED',
      },
    });
  }

  // ==================== 历史与摘要方法 ====================

  // 查询指定会话中已完成的消息，供模型使用
  private async getHistory(
    conversationId: string,
  ): Promise<{ role: string; content: string }[]> {
    return this.prisma.message.findMany({
      where: {
        conversationId,
        status: 'COMPLETED',
        conversation: {
          deletedAt: null,
        },
      },
      orderBy: {
        sequence: 'asc',
      },
      select: {
        role: true,
        content: true,
      },
    });
  }

  // 查询指定会话当前的滚动摘要
  private async getConversationSummary(
    conversationId: string,
  ): Promise<{
    content: Prisma.JsonValue;
    throughSequence: number;
  } | null> {
    return this.prisma.conversationSummary.findUnique({
      where: {
        conversationId,
      },
      select: {
        content: true,
        throughSequence: true,
      },
    });
  }

  // 查询上次摘要之后尚未处理的已完成消息
  private async getUnsummarizedMessages(
    conversationId: string,
  ): Promise<{
    sequence: number;
    role: string;
    content: string;
  }[]> {
    const summary = await this.getConversationSummary(conversationId);
    const throughSequence = summary?.throughSequence ?? 0;

    return this.prisma.message.findMany({
      where: {
        conversationId,
        status: 'COMPLETED',
        sequence: {
          gt: throughSequence,
        },
      },
      orderBy: {
        sequence: 'asc',
      },
      select: {
        sequence: true,
        role: true,
        content: true,
      },
    });
  }

  // 检查是否需要更新本轮会话摘要
  private async updateHistory(
    conversationId: string,
    onSystemMessage?: (message: string) => void,
  ): Promise<void> {
    const unsummarizedMessages =
      await this.getUnsummarizedMessages(conversationId);

    if (unsummarizedMessages.length < 20) {
      return;
    }

    const currentSummary =
      await this.getConversationSummary(conversationId);
    const previousSummary = currentSummary
      ? currentSummary.content
      : null;

    const newSummary = await this.summarizeHistory(
      unsummarizedMessages,
      previousSummary,
    );
    const lastMessage =
      unsummarizedMessages[unsummarizedMessages.length - 1];

    if (!lastMessage) {
      return;
    }

    await this.saveConversationSummary(
      conversationId,
      newSummary,
      lastMessage.sequence,
    );

    const systemMessage = '（系统已自动压缩历史上下文）';
    console.log(systemMessage);
    onSystemMessage?.(systemMessage);
  }

  // 根据旧摘要和新增消息生成新的滚动摘要
  private async summarizeHistory(
    messages: { role: string; content: string }[],
    previousSummary: Prisma.JsonValue | null = null,
  ): Promise<string> {
    const previousSummaryText = previousSummary
      ? `已有摘要：${JSON.stringify(previousSummary)}`
      : '目前没有已有摘要。';

    const summaryPrompt = [
      {
        role: 'system',
        content:
          '请根据已有摘要和新增对话，生成一份新的完整滚动摘要。' +
          '必须保留用户姓名、重要事实、当前目标和未解决的问题。' +
          `尽量简洁，不超过200字。${previousSummaryText}`,
      },
      ...messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    ];

    return this.callModel(summaryPrompt, 0.3);
  }

  // 新建或更新指定会话的滚动摘要
  private async saveConversationSummary(
    conversationId: string,
    summaryText: string,
    throughSequence: number,
  ): Promise<void> {
    const content = {
      text: summaryText,
    };

    await this.prisma.conversationSummary.upsert({
      where: {
        conversationId,
      },
      update: {
        content,
        throughSequence,
      },
      create: {
        conversationId,
        content,
        throughSequence,
      },
    });
  }
}
