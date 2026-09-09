
import { Controller, Post, Get, Delete, Body, Param, Res, Req, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import type { Request } from 'express';
import { ChatService } from './chat.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';

@Controller('api')          // 路由前缀为 /api @Controller是控制器装饰器
@UseGuards(SessionAuthGuard)
export class ChatController {
  /**
   * NestJS 启动装配 ChatModule 时注入 ChatService；每个接口方法只处理 HTTP 层，
   * 当前登录用户由 SessionAuthGuard 提前放入 request.session.userId。
   */
  constructor(private readonly chatService: ChatService) {}//constructor是构建函数 类被实例化就会执行
  //这里是module那边实例化了 所以执行了
  @Post('chat')             // 处理 POST /api/chat
  /**
   * 调用链：前端 sendMessage（非流式调用时）→ 本方法 → ChatService.getAIResponse →
   * 会话锁、消息事务、历史读取、AI API、完成消息和摘要 → 返回 { answer }。
   * conversationId/message 来自 JSON body，userId 来自 Session，不能由前端传入或覆盖。
   */
  async chat(@Body() body: { conversationId: string; message: string }, @Req() request: Request) {
    const answer = await this.chatService.getAIResponse(
      body.conversationId,
      body.message,
      request.session.userId!,
    );
    return { answer };
  }

  //请求sse流式输出
  @Post('chat/stream')
  /**
   * 调用链：前端 sendMessage → fetch('/api/chat/stream') → 本方法设置 SSE →
   * ChatService.streamAIResponse → onChunk 回调 res.write → [DONE] 或 error → 结束响应。
   * 浏览器断开只停止推送，Service 仍继续保存 AI 结果；这保证刷新页面后可通过消息查询恢复状态。
   */
  async chatStream(
    @Body() body: { conversationId: string; message: string },
    @Res() res: Response,
    @Req() request: Request,
  ) {
    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.status(200);
    res.flushHeaders(); // 立即发送响应头

    let clientConnected = true;

    // 浏览器刷新或关闭时，只停止实时推送，不取消后端任务
    res.on('close', () => {
      clientConnected = false;
    });

    const canWrite = () =>
      clientConnected && !res.destroyed && !res.writableEnded;

    // SSE 只负责实时推送，AI 任务会继续执行并保存数据库
    void this.chatService
      .streamAIResponse(
        body.conversationId,
        body.message,
        request.session.userId!,
        (chunk) => {
          if (canWrite()) {
            res.write(
              `data: ${JSON.stringify({ content: chunk })}\n\n`,
            );
          }
        },
        (message) => {
          if (canWrite()) {
            res.write(
              `data: ${JSON.stringify({
                type: 'system',
                message,
              })}\n\n`,
            );
          }
        },
      )
      .then(() => {
        if (canWrite()) {
          res.write(`data: [DONE]\n\n`);
          res.end();
        }
      })
      .catch((error: unknown) => {
        console.error('流式 AI 任务失败：', error);

        if (canWrite()) {
          const message =
            error instanceof Error ? error.message : '未知错误';
          res.write(
            `data: ${JSON.stringify({ error: message })}\n\n`,
          );
          res.end();
        }
      });
  }

  //收到前端post请求 调用createConversation生成会话 返回uuid
  @Post('conversations')
  /**
   * 调用链：前端 createNewConversation 或首次初始化 → 本方法 →
   * ChatService.createConversation(userId) → Conversation.create → 返回 conversationId。
   */
async createConversation(@Req() request: Request) {
  const conversationId = await this.chatService.createConversation(request.session.userId!);

  return {
    conversationId,
  };
}

//收到前端get请求 调用getConversations查询所有未被软删除的会话并返回
// (一般用于服务器重启或者其他刷新并重新渲染会话列表)
@Get('conversations')
/**
 * 调用链：前端 loadConversationsFromServer → 本方法 → ChatService.getConversations(userId) →
 * 查询当前用户未软删除会话 → 返回列表；userId 过滤在 Service/Prisma 查询中执行。
 */
async getConversations(@Req() request: Request) {
  return this.chatService.getConversations(request.session.userId!);
}

//收到前端get请求 需要一个uuid形参 查询uuid指向的会话的消息，供前端恢复聊天记录
@Get('conversations/:conversationId/messages')
/**
 * 调用链：前端 renderActiveConversation → loadConversationMessages → 本方法 →
 * ChatService.getConversationMessages(id,userId) → 查询归属当前用户的消息 → 返回消息数组。
 */
async getConversationMessages(
  @Param('conversationId') conversationId: string,
  @Req() request: Request,
) {
  return this.chatService.getConversationMessages(conversationId, request.session.userId!);
}

//收到前端请求 需要一个uuid的形参 软删除该会话里的所有数据
@Delete('chat/:conversationId')
/**
 * 调用链：前端确认删除 → performDeleteConversation → 本方法 →
 * ChatService.deleteHistory(id,userId) → updateMany 软删除 → 返回 deleted。
 * 非当前用户会话的 updateMany count 为 0，前端不会误删其他用户数据。
 */
async deleteChatHistory(
  @Param('conversationId') conversationId: string,
  @Req() request: Request,
) {
  const deleted = await this.chatService.deleteHistory(conversationId, request.session.userId!);

  return { deleted };
}

}
