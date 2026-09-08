import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  // AuthService 需要 PrismaService，因此导入 PrismaModule。
  imports: [PrismaModule],
  // AuthController 负责接收 /api/auth 下的请求。
  controllers: [AuthController],
  // AuthService 由 NestJS 创建并注入到控制器。
  providers: [AuthService],
  // 导出后，其他模块可以复用注册、登录等认证能力。
  exports: [AuthService],
})
export class AuthModule {}
