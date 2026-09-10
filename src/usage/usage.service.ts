import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/// ChatService 在模型调用成功后上报的用量信息。
/// usage 是上游返回的精确值；estimateContext 是上游未返回 usage 时的估算兜底输入。
type RecordAiUsageInput = {
  userId: string;
  conversationId?: string | null;
  messageId?: string | null;
  requestType: 'CHAT' | 'STREAM' | 'SUMMARY';
  model: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
  estimateContext?: {
    messages: { role: string; content: string }[];
    outputText: string;
  };
};

type ResolvedAiUsage = {
  source: 'UPSTREAM' | 'ESTIMATED';
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number;
};

@Injectable()
export class UsageService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 调用者：ChatService.getAIResponse / streamAIResponse / updateHistory。
   * 输入参数来自模型调用成功后解析出的 usage 和调用上下文；优先写入上游精确 token，
   * 只有上游未返回 usage 时才使用 estimateContext 估算，并标记为 ESTIMATED。
   * 成功时在同一事务中写入 AiUsageRecord、累加 UserUsageSummary，并在有关联会话时累加
   * ConversationUsageSummary；失败只记录日志，不阻断聊天主流程。
   */
  async record(input: RecordAiUsageInput): Promise<void> {
    try {
      const usage = this.resolveUsage(input);
      const summaryIncrement = {
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        totalTokens: usage.totalTokens,
      };

      await this.prisma.$transaction(async (tx) => {
        await tx.aiUsageRecord.create({
          data: {
            userId: input.userId,
            conversationId: input.conversationId ?? null,
            messageId: input.messageId ?? null,
            requestType: input.requestType,
            source: usage.source,
            model: input.model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
          },
        });

        await tx.userUsageSummary.upsert({
          where: {
            userId: input.userId,
          },
          create: {
            userId: input.userId,
            ...summaryIncrement,
            callCount: 1,
          },
          update: {
            inputTokens: {
              increment: summaryIncrement.inputTokens,
            },
            outputTokens: {
              increment: summaryIncrement.outputTokens,
            },
            totalTokens: {
              increment: summaryIncrement.totalTokens,
            },
            callCount: {
              increment: 1,
            },
          },
        });

        if (input.conversationId) {
          await tx.conversationUsageSummary.upsert({
            where: {
              conversationId: input.conversationId,
            },
            create: {
              conversationId: input.conversationId,
              ...summaryIncrement,
              callCount: 1,
            },
            update: {
              inputTokens: {
                increment: summaryIncrement.inputTokens,
              },
              outputTokens: {
                increment: summaryIncrement.outputTokens,
              },
              totalTokens: {
                increment: summaryIncrement.totalTokens,
              },
              callCount: {
                increment: 1,
              },
            },
          });
        }
      });
    } catch (error) {
      console.error('Token 用量记录失败，不阻断聊天流程：', error);
    }
  }

  // 优先采用上游返回的 usage；只有 total_tokens 有效时才视为精确记录，否则按上下文估算。
  private resolveUsage(input: RecordAiUsageInput): ResolvedAiUsage {
    const upstreamTotal = this.normalizeTokenCount(input.usage?.total_tokens);

    if (upstreamTotal !== null) {
      return {
        source: 'UPSTREAM',
        inputTokens: this.normalizeTokenCount(input.usage?.prompt_tokens),
        outputTokens: this.normalizeTokenCount(input.usage?.completion_tokens),
        totalTokens: upstreamTotal,
      };
    }

    const messages = input.estimateContext?.messages ?? [];
    const outputText = input.estimateContext?.outputText ?? '';
    const inputTokens = this.estimateMessageTokens(messages);
    const outputTokens = this.estimateTextTokens(outputText);

    return {
      source: 'ESTIMATED',
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    };
  }

  // 过滤模型返回的非法 token 数值，汇总累加时只使用非负整数。
  private normalizeTokenCount(value: number | undefined): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return null;
    }

    return Math.trunc(value);
  }

  // 上游没有返回 usage 时，按照消息列表和回复文本粗略估算输入 token。
  private estimateMessageTokens(
    messages: { role: string; content: string }[],
  ): number {
    const promptText = messages
      .map((message) => `${message.role}: ${message.content}`)
      .join('\n');

    return this.estimateTextTokens(promptText);
  }

  // 粗略估算：中文按约 1.5 字符一个 token，其他字符按约 4 字符一个 token。
  private estimateTextTokens(text: string): number {
    const cjkCount = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
    const otherCount = text.length - cjkCount;

    return Math.ceil(cjkCount / 1.5 + otherCount / 4);
  }
}
