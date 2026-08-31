
import { Controller, Post, Delete, Body, Param, Res } from '@nestjs/common';
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

    try {
      // 调用流式方法，每收到一个文本块就通过 res.write 发送给前端
      await this.chatService.streamAIResponse(
        body.conversationId,
        body.message,
        (chunk) => {
          res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      },
      (message) => {
        res.write(`data: ${JSON.stringify({
          type: 'system',
          message,
        })}\n\n`
        );
      },
    );
      // 发送完成标记
      res.write(`data: [DONE]\n\n`);
      res.end();
    } catch (error) {
      // 发送错误信息
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  }

  @Delete('chat/:conversationId')
deleteChatHistory(
  @Param('conversationId') conversationId: string,
) {
  const deleted = this.chatService.deleteHistory(conversationId);

  return { deleted };
}

}