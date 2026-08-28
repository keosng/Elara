//Module = 启动时的装配说明书 + 功能边界 启动之后告诉大家各位是谁 都干嘛的

import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}