# Elara 项目上下文

## 项目定位

Elara 是一个剧情向 AI 陪伴游戏，而不是普通的通用 AI 聊天应用。用户会与单一核心角色 Elara 长期互动，通过对话、线索、网页解谜和选择影响信任与好感度，探索多个结局。通关后关系继续存在，用户可以继续陪伴或重新探索其他路线。

核心表达：有终点的故事，无终点的关系。

## 技术栈与入口

- 后端：NestJS 11 + TypeScript
- 数据库：PostgreSQL + Prisma 7
- 前端：原生 HTML/CSS/JavaScript
- 当前主页：`public/index.html`，用于保证基础聊天功能可用
- 未来主页候选：`public/corridor-demo.html`，场景化前端原型，完善后逐步接入后端
- 启动入口：`src/main.ts`
- 聊天模块：`src/chat/`
- Prisma 封装：`src/prisma/`
- 数据模型和迁移：`prisma/`

## 当前已完成

- AI 普通回复和 SSE 流式回复
- 多会话创建、列表、恢复和软删除
- 消息持久化和消息状态：`PENDING`、`COMPLETED`、`FAILED`
- 长对话滚动摘要
- `User` 表和 `Conversation.userId` 数据模型
- `ConfigModule` + Joi 启动配置校验
- `ChatService` 通过 `ConfigService` 读取环境变量

## 当前未完成

- 用户注册、登录、密码认证
- JWT/Session 鉴权
- 按当前用户隔离会话和消息
- Elara 人格、长期记忆、好感度和信任系统
- 网页解谜、多结局和通关后陪伴模式
- Token 使用监测
- 全流程统一跟踪日志

## 开发约定

- 使用中文与项目维护者沟通和解释。
- 先阅读相关文件和现有测试，再做最小范围修改。
- 不提交 `.env`、真实 API Key、数据库密码或其他凭据。
- 不把 `DEV_USER_ID` 当作正式认证方案；它只是认证完成前的开发占位。
- 好感度、剧情状态、线索和结局应由后端状态逻辑控制，AI 主要负责角色表达。
- 修改后优先运行 `npm run build` 和相关测试。

## 常用命令

```bash
npm run start:dev
npm run build
npm test -- --runInBand
npm run test:e2e
npx prisma migrate status
npx prisma generate
```

## 环境变量

本机配置在 `.env`，公开模板在 `.env.example`。当前主要变量包括 `API_KEY`、`BASE_URL`、`MODEL`、`DATABASE_URL` 和开发阶段的 `DEV_USER_ID`。不要读取、输出或提交 `.env` 的真实内容。

## 继续工作前的建议

开始新任务时，先查看 `README.md` 的“当前进度”和“下一步计划”，再检查 Git 工作区状态。完成一个可验证阶段后，更新 README/本文件的进度并提交 Git。
