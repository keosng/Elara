import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  
  // 提供静态文件（public 目录）
  app.useStaticAssets('public');
    // 默认路由前缀是 '/'，所以访问 http://localhost:3000/ 会返回 public/index.html

  await app.listen(3000);
  console.log('服务器运行在 http://localhost:3000');
}
bootstrap();