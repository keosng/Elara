# Elara

一个基于 NestJS、Prisma 和 PostgreSQL 的剧情向 AI 陪伴游戏。

用户将通过聊天、观察线索、解开谜题和做出选择，逐步了解 Elara 的过去，并影响她对用户的信任与好感。随着关系的发展，故事会走向不同结局。

但通关并不意味着故事结束。结局完成后，Elara 仍会继续陪伴用户；用户可以继续与她互动，也可以重新开始，探索其他可能的结局。

> 有终点的故事，无终点的关系。

## 核心体验

- 与具有独立人格的 AI 角色 Elara 长期互动
- 通过自然对话推进剧情
- 在网页环境中发现线索并完成解谜
- 好感度、信任和记忆影响角色反应
- 多个剧情结局
- 通关后继续陪伴，而不是让角色消失
- 重新开始，探索不同的故事路线

## 角色

### Elara

Elara 是本作唯一的核心角色。她的性格、记忆和情绪会随着互动逐步展开，用户需要通过对话和探索，理解她正在经历的事情，以及她为什么会出现在这个网页中。

本作中的陪伴关系以角色叙事、信任和情感连接为核心。

## 当前进度

- [x] NestJS 聊天接口
- [x] SSE 流式 AI 回复
- [x] 多会话创建、列表、恢复和软删除
- [x] PostgreSQL + Prisma 消息持久化
- [x] 会话消息状态：`PENDING`、`COMPLETED`、`FAILED`
- [x] 长对话滚动摘要
- [x] 用户表和会话归属的数据模型
- [ ] Elara 人格系统
- [ ] 好感度与信任系统
- [ ] 角色长期记忆
- [ ] 网页解谜机制
- [ ] 多结局剧情系统
- [ ] 通关后的持续陪伴模式
- [x] 用户注册接口和密码安全存储
- [x] 用户登录和密码认证
- [x] Session 鉴权和 HttpOnly Cookie
- [x] 按当前用户隔离会话和消息
- [x] Token 用量记录与汇总（`AiUsageRecord` + `UserUsageSummary` + `ConversationUsageSummary` + `UsageService`）

项目正在从通用 AI 聊天应用，逐步发展为以角色关系和剧情探索为核心的 AI 互动故事。

当前用户系统已完成注册、登录、密码校验、Session 鉴权和会话按用户隔离。`DEV_USER_ID` 仅作为直接调用 `ChatService` 的开发兼容默认值，可不配置；HTTP 接口使用登录 Session 中的用户身份。

## 下一步计划

接下来会优先完善后端的基础能力，再逐步接入 Elara 的剧情系统：

1. **完善用户系统**
   - 用户注册、登录和密码安全存储（已完成）
   - Session 鉴权与 HttpOnly Cookie（已完成）
   - 按当前用户隔离会话、消息和剧情数据（已完成）
   - 前端注册、登录态展示和注销入口（已完成）
   - CSRF 防护

2. **增加 Token 使用监测**
   - 记录每次模型请求的 Token 使用量（已完成基础记录和用户/会话汇总）
   - 区分普通回复、流式回复和摘要请求（已完成）
   - 后续增加用量统计查询、成本汇总或前端展示

3. **完善全流程跟踪日志**
   - 为请求、会话、消息和模型调用建立统一的跟踪信息
   - 记录流程当前阶段、关键状态变化和错误位置
   - 让一次对话从进入接口到写入数据库的完整路径可追踪、可定位

日志系统的目标不是输出更多无关内容，而是让关键流程透明化，方便开发过程中理解代码执行路径，并在出现问题时快速定位。

## 未来基础设施规划

### Redis

当前单实例开发阶段暂不立即引入 Redis。项目满足以下条件之一时，再评估接入 Redis：

- 部署多个后端实例，需要共享会话锁或其他并发状态
- 登录 Session 或多设备登录状态需要高频访问
- AI 上下文缓存、短期记忆或摘要读取造成 PostgreSQL 性能压力
- 增加接口限流、任务队列、实时状态等临时数据能力

Redis 主要用于 Session、分布式锁、缓存和临时状态；用户、消息、剧情进度、好感度和信任度等长期数据继续保存在 PostgreSQL。实现 AI 上下文时，优先保留可替换的存储接口，方便未来增加 Redis 缓存而不改动核心业务流程。

## 技术栈

- NestJS 11
- TypeScript
- Prisma 7 + PostgreSQL
- 原生 HTML/CSS/JavaScript

## 前端现状

当前项目通过 `public/index.html` 作为临时主页，用于承载现阶段的 AI 对话和会话功能。

`public/corridor-demo.html` 是正在完善中的场景化前端原型，未来可能会逐步替代 `index.html` 成为正式主页。待场景、交互和 Elara 的剧情容器完善后，会将它与现有后端接口逐步对接，包括用户系统、会话管理、消息持久化、好感度和剧情状态等能力。

因此，当前仓库中的前端页面处于并行演进阶段：`index.html` 优先保证基础功能可用，`corridor-demo.html` 优先探索最终产品的视觉和交互方向。

## 本地运行

环境要求：Node.js、PostgreSQL。

```bash
npm install
cp .env.example .env
```

Windows PowerShell 可以使用：

```powershell
Copy-Item .env.example .env
```

然后在 `.env` 中填写 AI 服务和 PostgreSQL 连接信息，并确保 `DEV_USER_ID` 对应数据库中的用户记录。

```bash
npx prisma migrate deploy
npx prisma generate
npm run start:dev
```

打开 <http://localhost:3000>。

## 常用命令

```bash
npm run build       # 构建
npm test            # 单元测试
npm run test:e2e    # 端到端测试
npx prisma migrate status
```

## 安全说明

- `.env` 只存在于本机，不要提交到 Git。
- `.env.example` 不包含真实密钥，只用于说明配置项。
- 如果密钥曾经泄露，请立即在服务商后台轮换。
- 当前认证和用户权限仍在开发中，不要把当前版本作为生产服务部署。

## 项目结构

```text
src/chat/       聊天接口和聊天业务逻辑
src/usage/      Token 用量记录模块
src/prisma/     Prisma 客户端封装
prisma/         数据模型和数据库迁移
public/         静态前端页面、样式和场景资源
test/           E2E 测试
```
