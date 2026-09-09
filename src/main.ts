import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import session from 'express-session';
import { PrismaSessionStore } from './auth/prisma-session.store';
import { PrismaService } from './prisma/prisma.service';

async function bootstrap() {
  /**
   * 启动调用链：NestFactory.create(AppModule) → PrismaService 已连接数据库 →
   * 注册 express-session 中间件 → 所有后续请求先读取 HttpOnly Cookie →
   * 挂载 public 静态文件 → 监听 3000 端口。
   */
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const prisma = app.get(PrismaService);
  app.use(
    session({
      name: 'elara.sid',
      secret: process.env.SESSION_SECRET ?? 'elara-development-session-secret-change-me',
      resave: false,
      saveUninitialized: false,
      rolling: true,
      store: new PrismaSessionStore(prisma),
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    }),
  );
  
  // 提供静态文件（public 目录）
  app.useStaticAssets('public');
    // 默认路由前缀是 '/'，所以访问 http://localhost:3000/ 会返回 public/index.html

  await app.listen(3000);
  console.log('服务器运行在 http://localhost:3000');
}
bootstrap();
