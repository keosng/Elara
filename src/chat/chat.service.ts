import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { UsageService } from '../usage/usage.service';
import type { Prisma } from '../../generated/prisma/client';

// 上游 chat/completions 返回的 token 用量结构。
type ModelUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

// 模型调用统一返回：正文、是否拿到的 usage、实际使用的模型名。
type ModelResult = {
  content: string;
  usage?: ModelUsage | null;
  model: string;
};

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly usageService: UsageService,
  ) {}


  // ==================== 对外会话接口 ====================

  // 创建一个新会话，并返回会话 UUID
  async createConversation(userId: string): Promise<string> {
    /** 调用者：ChatController.createConversation；创建请求已通过 SessionAuthGuard。写入 userId 后把新 UUID 返回给前端。 */
    const conversation = await this.prisma.conversation.create({
      data: {
        userId,
      },
    });

    return conversation.id;
  }

  // 查询所有未被软删除的会话，供前端刷新会话列表
  async getConversations(userId: string) {
    /** 调用者：ChatController.getConversations；只查询 userId 匹配且 deletedAt=null 的会话，防止跨用户读取。 */
    return this.prisma.conversation.findMany({
      where: {
        deletedAt: null,
        userId,
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
  async getConversationMessages(conversationId: string, userId: string) {
    /** 调用者：ChatController.getConversationMessages；通过消息关联的 Conversation 同时检查 userId 和软删除状态。 */
    return this.prisma.message.findMany({
      where: {
        conversationId,
        conversation: {
          deletedAt: null,
          userId,
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
  async deleteHistory(conversationId: string, userId: string): Promise<boolean> {
    /** 调用者：ChatController.deleteChatHistory；只更新当前用户未删除的会话，返回 updateMany.count > 0。 */
    const result = await this.prisma.conversation.updateMany({
      where: {
        id: conversationId,
        deletedAt: null,
        userId,
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
    userId = this.configService.getOrThrow<string>('DEV_USER_ID'),
  ): Promise<string> {
    /**
     * 调用者：ChatController.chat。调用顺序：withConversationLock → createPendingMessages → askAI →
     * completePendingMessage → usageService.record → updateHistory；任意 AI/数据库错误都进入 failPendingMessage，
     * 再由 Controller 返回错误。
     * userId 由 HTTP Session 传入；默认 DEV_USER_ID 只为旧单测或内部开发调用保留。
     */
    return this.withConversationLock(
      conversationId,
      async () => {
        const assistantMessageId =
          await this.createPendingMessages(
            conversationId,
            userMessage,
            userId,
          );

        try {
          const modelResult = await this.askAI(conversationId);

          await this.completePendingMessage(
            assistantMessageId,
            modelResult.content,
          );

          await this.usageService.record({
            userId,
            conversationId,
            messageId: assistantMessageId,
            requestType: 'CHAT',
            model: modelResult.model,
            usage: modelResult.usage,
            estimateContext: {
              messages: modelResult.inputMessages,
              outputText: modelResult.content,
            },
          });

          await this.updateHistory(conversationId, userId);

          return modelResult.content;
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
    userId = this.configService.getOrThrow<string>('DEV_USER_ID'),
    onChunk: (chunk: string) => void,
    onSystemMessage?: (message: string) => void,
  ): Promise<void> {
    /**
     * 调用者：ChatController.chatStream。调用顺序：加锁 → 创建用户/PENDING 消息 → getHistory →
     * streamModelResponse(onChunk) → 完成消息 → usageService.record → onSystemMessage 发送 Token 用量 →
     * updateHistory；失败则标记 FAILED，最后释放锁。
     * onChunk 和 onSystemMessage 是 Controller 提供的推送回调，Service 不直接操作 HTTP Response。
     */
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
            userId,
          );

        try {
          const history = await this.getHistory(conversationId);

          const modelResult =
            await this.streamModelResponse(
              history,
              onChunk,
            );

          await this.completePendingMessage(
            assistantMessageId,
            modelResult.content,
          );

          await this.usageService.record({
            userId,
            conversationId,
            messageId: assistantMessageId,
            requestType: 'STREAM',
            model: modelResult.model,
            usage: modelResult.usage,
            estimateContext: {
              messages: history,
              outputText: modelResult.content,
            },
          });

          const usage = modelResult.usage;
          const usageMessage =
            usage?.total_tokens != null
              ? `Token 用量：输入 ${usage.prompt_tokens ?? '未知'} · 输出 ${usage.completion_tokens ?? '未知'} · 总计 ${usage.total_tokens}`
              : 'Token 用量：本次暂未获取';
          onSystemMessage?.(usageMessage);

          await this.updateHistory(
            conversationId,
            userId,
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
    /**
     * 调用者：getAIResponse 和 streamAIResponse 的第一层协调方法。
     * 已有同会话任务时立即抛错；否则加锁并执行 task，成功或失败都在 finally 删除锁。
     */
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
  private async askAI(
    conversationId: string,
  ): Promise<ModelResult & { inputMessages: { role: string; content: string }[] }> {
    /** 调用者：getAIResponse；先由 getHistory 取已完成消息，再交给 callModel，并把输入消息一起带回供估算使用。 */
    const history = await this.getHistory(conversationId);
    const modelResult = await this.callModel(history);

    return {
      ...modelResult,
      inputMessages: history,
    };
  }

  // 调用 AI 模型，等待完整响应后返回
  private async callModel(
    messages: { role: string; content: string }[],
    temperature?: number,
  ): Promise<ModelResult> {
    /**
     * 调用者：askAI 和 summarizeHistory。读取 ConfigService 中的 BASE_URL/API_KEY/MODEL，
     * 调用非流式 chat/completions；HTTP 非 2xx 时抛错，成功时返回正文、usage 和实际模型名。
     */
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
    return {
      content: data.choices[0].message.content,
      usage: data.usage,
      model,
    };
  }

  // 调用 AI 模型并解析流式响应，逐段交给 Controller
  private async streamModelResponse(
    messages: { role: string; content: string }[],
    onChunk: (chunk: string) => void,
  ): Promise<ModelResult> {
    /**
     * 调用者：streamAIResponse。请求 stream=true，逐块解析上游 SSE，提取 delta.content 后调用 onChunk，
     * 同时累加 fullAnswer；开启 stream_options.include_usage 让上游在结束前返回 usage，最终交回完整文本和 token 统计。
     */
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
          stream_options: {
            include_usage: true,
          },
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
    let usage: ModelUsage | null = null;

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
          if (json.usage) {
            usage = json.usage;
          }

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

    return {
      content: fullAnswer,
      usage,
      model,
    };
  }

  // ==================== 消息持久化方法 ====================

  // 立即保存用户消息，并创建一条等待 AI 生成的消息
  private async createPendingMessages(
    conversationId: string,
    userMessage: string,
    userId: string,
  ): Promise<string> {
    /**
     * 调用者：两条聊天入口进入 AI 请求前。事务内先确认会话 id/userId/deletedAt，
     * 再写入用户 COMPLETED 消息、AI PENDING 消息和首条消息标题；任一步失败则整笔事务回滚。
     */
    const assistantMessage = await this.prisma.$transaction(async (tx) => {
      const conversation = await tx.conversation.findFirst({
        where: { id: conversationId, userId, deletedAt: null },
        select: { title: true },
      });
      if (!conversation) {
        throw new Error('会话不存在或无权访问');
      }

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
    /** 调用者：普通或流式 AI 成功后，把对应 PENDING 消息写成完整 content + COMPLETED。 */
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
    /** 调用者：两条聊天入口的 catch；只把对应 AI 消息标记 FAILED，保留用户消息和失败记录。 */
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
    /** 调用者：askAI 和 streamAIResponse；只把当前未删除会话的 COMPLETED 消息交给模型。 */
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
    /** 调用者：getUnsummarizedMessages 和 updateHistory；读取当前会话上一次摘要及处理到的 sequence。 */
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
    /** 调用者：updateHistory；根据摘要 throughSequence 找出之后新增的已完成消息。 */
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
    userId: string,
    onSystemMessage?: (message: string) => void,
  ): Promise<void> {
    /**
     * 调用者：普通/流式聊天完成后。少于 20 条新增消息直接结束；达到阈值时依次调用
     * getConversationSummary → summarizeHistory → usageService.record → saveConversationSummary，
     * 并通过 onSystemMessage 通知前端。userId 用于写入摘要调用对应的 token 用量记录。
     */
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

    const summaryResult = await this.summarizeHistory(
      unsummarizedMessages,
      previousSummary,
    );

    await this.usageService.record({
      userId,
      conversationId,
      requestType: 'SUMMARY',
      model: summaryResult.model,
      usage: summaryResult.usage,
      estimateContext: {
        messages: unsummarizedMessages,
        outputText: summaryResult.content,
      },
    });

    const lastMessage =
      unsummarizedMessages[unsummarizedMessages.length - 1];

    if (!lastMessage) {
      return;
    }

    await this.saveConversationSummary(
      conversationId,
      summaryResult.content,
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
  ): Promise<ModelResult> {
    /** 调用者：updateHistory；组合旧摘要和新增消息后调用低温度 callModel，返回正文、usage 和模型名。 */
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
    /** 调用者：updateHistory；使用 upsert 新建或覆盖 ConversationSummary，并记录摘要覆盖到的 sequence。 */
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
