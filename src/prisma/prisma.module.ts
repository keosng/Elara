//Module = 启动时的装配说明书 + 功能边界 启动之后告诉大家各位是谁 都干嘛的

import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}