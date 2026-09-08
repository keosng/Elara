
import { Controller, Post, Get, Delete, Body, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ChatService } from './chat.service';

@Controller('api')          // 路由前缀为 /api @Controller是控制器装饰器
export class ChatController {
  constructor(private readonly chatService: ChatService) {}//constructor是构建函数 类被实例化就会执行
  //这里是module那边实例化了 所以执行了
  @Post('chat')             // 处理 POST /api/chat
  async chat(@Body() body: { conversationId: string; message: string }) {
    const answer = await this.chatService.getAIResponse(
      body.conversationId,
      body.message,
    );
    return { answer };
  }

  //请求sse流式输出
  @Post('chat/stream')
  async chatStream(
    @Body() body: { conversationId: string; message: string },
    @Res() res: Response,
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
async createConversation() {
  const conversationId = await this.chatService.createConversation();

  return {
    conversationId,
  };
}

//收到前端get请求 调用getConversations查询所有未被软删除的会话并返回
// (一般用于服务器重启或者其他刷新并重新渲染会话列表)
@Get('conversations')
async getConversations() {
  return this.chatService.getConversations();
}

//收到前端get请求 需要一个uuid形参 查询uuid指向的会话的消息，供前端恢复聊天记录
@Get('conversations/:conversationId/messages')
async getConversationMessages(
  @Param('conversationId') conversationId: string,
) {
  return this.chatService.getConversationMessages(conversationId);
}

//收到前端请求 需要一个uuid的形参 软删除该会话里的所有数据
@Delete('chat/:conversationId')
async deleteChatHistory(
  @Param('conversationId') conversationId: string,
) {
  const deleted = await this.chatService.deleteHistory(conversationId);

  return { deleted };
}

}
