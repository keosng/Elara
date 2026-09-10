import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/// ChatService 在模型调用成功后上报的用量信息。
/// usage 是上游返回的精确值；estimateContext 是上游部分或全部字段缺失时的估算兜底输入。
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
  source: 'UPSTREAM' | 'PARTIAL' | 'ESTIMATED';
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number;
};

type UsageSummaryValues = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  callCount: number;
  unknownInputCallCount: number;
  unknownOutputCallCount: number;
};

@Injectable()
export class UsageService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 调用者：UsageController.getUsageOverview，由已登录页面初始化和每轮聊天结束后的前端请求触发。
   * 输入 userId 来自 SessionAuthGuard 写入的 request.session.userId，不能由前端覆盖。
   * 查询用户汇总和当前用户未删除会话的汇总，并把没有汇总记录的新用户或新会话补成 0；
   * 返回值由 UsageController 交给前端 Token 账簿使用。Prisma 查询失败会向上抛出，由 NestJS HTTP 层处理。
   */
  async getUsageOverview(userId: string) {
    const [userSummary, conversationSummaries] = await Promise.all([
      this.prisma.userUsageSummary.findUnique({
        where: {
          userId,
        },
        select: {
          inputTokens: true,
          outputTokens: true,
          totalTokens: true,
          callCount: true,
          unknownInputCallCount: true,
          unknownOutputCallCount: true,
        },
      }),
      this.prisma.conversationUsageSummary.findMany({
        where: {
          conversation: {
            userId,
            deletedAt: null,
          },
        },
        select: {
          conversationId: true,
          inputTokens: true,
          outputTokens: true,
          totalTokens: true,
          callCount: true,
          unknownInputCallCount: true,
          unknownOutputCallCount: true,
        },
      }),
    ]);

    return {
      user: this.normalizeUsageSummary(userSummary),
      conversations: conversationSummaries.map((summary) => ({
        conversationId: summary.conversationId,
        ...this.normalizeUsageSummary(summary),
      })),
    };
  }

  /**
   * 调用者：ChatService.getAIResponse / streamAIResponse / updateHistory。
   * 输入参数来自模型调用成功后解析出的 usage 和调用上下文；上游字段按个采用，
   * 总量缺失时可由输入和输出相加补出，只有缺失字段才使用 estimateContext 估算。
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
        unknownInputCallCount: usage.inputTokens === null ? 1 : 0,
        unknownOutputCallCount: usage.outputTokens === null ? 1 : 0,
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
            unknownInputCallCount: {
              increment: summaryIncrement.unknownInputCallCount,
            },
            unknownOutputCallCount: {
              increment: summaryIncrement.unknownOutputCallCount,
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
              unknownInputCallCount: {
                increment: summaryIncrement.unknownInputCallCount,
              },
              unknownOutputCallCount: {
                increment: summaryIncrement.unknownOutputCallCount,
              },
            },
          });
        }
      });
    } catch (error) {
      console.error('Token 用量记录失败，不阻断聊天流程：', error);
    }
  }

  // 把数据库可能为空的汇总记录统一补成前端可直接展示的 0，避免每个调用点重复判空。
  private normalizeUsageSummary(
    summary: UsageSummaryValues | null,
  ): UsageSummaryValues {
    return {
      inputTokens: summary?.inputTokens ?? 0,
      outputTokens: summary?.outputTokens ?? 0,
      totalTokens: summary?.totalTokens ?? 0,
      callCount: summary?.callCount ?? 0,
      unknownInputCallCount: summary?.unknownInputCallCount ?? 0,
      unknownOutputCallCount: summary?.unknownOutputCallCount ?? 0,
    };
  }

  // 优先采用上游返回的 usage；总量有效时直接采用，缺失时再由输入、输出补出。
  private resolveUsage(input: RecordAiUsageInput): ResolvedAiUsage {
    const upstreamInput = this.normalizeTokenCount(input.usage?.prompt_tokens);
    const upstreamOutput = this.normalizeTokenCount(
      input.usage?.completion_tokens,
    );
    const upstreamTotal = this.normalizeTokenCount(input.usage?.total_tokens);

    if (upstreamTotal !== null) {
      return {
        source: 'UPSTREAM',
        inputTokens: upstreamInput,
        outputTokens: upstreamOutput,
        totalTokens: upstreamTotal,
      };
    }

    if (upstreamInput !== null && upstreamOutput !== null) {
      return {
        source: 'UPSTREAM',
        inputTokens: upstreamInput,
        outputTokens: upstreamOutput,
        totalTokens: upstreamInput + upstreamOutput,
      };
    }

    const messages = input.estimateContext?.messages ?? [];
    const outputText = input.estimateContext?.outputText ?? '';
    const inputTokens = upstreamInput ?? this.estimateMessageTokens(messages);
    const outputTokens = upstreamOutput ?? this.estimateTextTokens(outputText);

    return {
      source:
        upstreamInput === null && upstreamOutput === null
          ? 'ESTIMATED'
          : 'PARTIAL',
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
