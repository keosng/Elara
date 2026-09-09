# Elara 前端驱动全流程地图

## 使用说明

### 阅读顺序

#### 先看用户操作

#### 再看前端事件和函数

#### 然后看 fetch 请求

#### 最后看 NestJS 类、方法、数据库和 AI

### 图例

#### 类：负责一类业务

#### 方法：执行一个具体动作

#### Controller：接收 HTTP 请求

#### Service：处理业务逻辑

#### PrismaService：访问 PostgreSQL

## 启动阶段：用户打开网页

### 用户动作：访问 /

#### 前端

##### 浏览器加载 public/index.html：聊天页面、按钮、输入框和弹窗

##### 浏览器加载 public/style.css：负责页面样式

##### 页面底部 module script 开始执行

#### 前端初始化方法

##### loadConversationsFromServer()

###### 用途：向后端读取当前用户的未删除会话

###### 请求：GET /api/conversations

##### 如果后端失败：loadConversations()

###### 用途：从 localStorage 读取本地备用会话

##### createConversation()

###### 调用条件：没有 activeConversationId，或当前会话已不存在

###### 请求：POST /api/conversations

###### 返回：conversationId

##### saveState()

###### 用途：保存会话列表和当前会话 ID 到 localStorage

##### renderConversationList()

###### 用途：把会话列表绘制到左侧栏

##### renderActiveConversation()

###### 用途：读取当前会话消息并绘制聊天区

###### 请求：GET /api/conversations/:conversationId/messages

## 用户新建会话

### 用户动作：点击“新建会话”

#### 前端事件：newConversationButton click

#### 前端方法：createNewConversation()

##### 调用条件：当前没有正在发送消息

##### 前端调用：createConversation()

##### HTTP：POST /api/conversations

#### 后端：ChatController.createConversation()

##### 用途：接收创建会话请求

##### 调用：ChatService.createConversation()

#### 后端：ChatService.createConversation()

##### 用途：创建数据库会话并返回 UUID

##### 读取：ConfigService.getOrThrow('DEV_USER_ID')

##### 写入：PrismaService.conversation.create()

##### 数据库：Conversation 表

#### 返回前端

##### 前端更新 conversations 数组

##### 前端更新 activeConversationId

##### saveState()

##### renderConversationList()

##### renderActiveConversation()

## 用户切换会话

### 用户动作：点击某个会话

#### 前端事件：conversation-select button click

#### 前端方法：selectConversation(conversationId)

##### 调用条件：没有发送中，且目标不是当前会话

##### saveState()

##### renderConversationList()

##### renderActiveConversation()

#### 前端方法：loadConversationMessages(conversationId)

##### HTTP：GET /api/conversations/:conversationId/messages

#### 后端：ChatController.getConversationMessages(conversationId)

##### 用途：接收会话消息查询请求

##### 调用：ChatService.getConversationMessages(conversationId)

#### 后端：ChatService.getConversationMessages(conversationId)

##### 用途：查询未删除会话中的消息

##### 数据库：PrismaService.message.findMany()

##### 条件：conversationId 匹配、conversation.deletedAt 为 null

##### 排序：sequence 升序

#### 前端显示

##### renderMessages(conversation)

###### PENDING：显示“AI 正在思考”

###### FAILED：显示“AI 回复失败，请重新发送”

###### COMPLETED：显示消息正文

## 用户发送消息：流式聊天主流程

### 用户动作：点击“发送”或输入框按 Enter

#### 前端事件

##### sendButton click

##### userInput keydown + Enter

#### 前端方法：sendMessage()

##### 调用条件：输入非空、存在当前会话、当前没有发送任务

##### 前端方法：recordUserMessage(conversationId, text)

###### 用途：立即把用户消息显示并保存到本地状态

##### 前端方法：setSendingState(true)

###### 用途：禁用切换和删除，防止并发操作

##### 前端方法：addMessage('assistant', '')

###### 用途：创建 AI 回复的占位元素

##### 前端请求

###### HTTP：POST /api/chat/stream

###### Body：{ conversationId, message }

###### 响应：SSE 流，Content-Type 为 text/event-stream

#### 后端：ChatController.chatStream(body, res)

##### 用途：建立 SSE 响应并把 AI 片段推给浏览器

##### 设置响应头：Content-Type、Cache-Control、Connection

##### 监听 res.close：浏览器关闭时停止推送

##### 调用：ChatService.streamAIResponse()

##### onChunk(chunk)：如果客户端仍连接，res.write 推送文字片段

##### onSystemMessage(message)：推送摘要压缩提示

##### 成功：发送 data: [DONE] 并结束响应

##### 失败：发送 error 事件并结束响应

#### 后端：ChatService.streamAIResponse()

##### 用途：协调流式消息的完整生命周期

##### 调用：withConversationLock(conversationId, task)

###### 条件：同一会话已有任务时抛出“上一条回复仍在生成”

##### 调用：createPendingMessages(conversationId, userMessage)

###### 事务写入：用户 COMPLETED 消息 + AI PENDING 消息

###### 首条消息时更新 Conversation.title

##### 调用：getHistory(conversationId)

###### 用途：取出未删除会话中所有 COMPLETED 消息

##### 调用：streamModelResponse(history, onChunk)

###### 用途：请求 AI 流式接口并逐段解析 SSE

##### 调用：completePendingMessage(id, fullAnswer)

###### 成功条件：AI 流正常结束

###### 更新：assistant 消息 content 和 status=COMPLETED

##### 调用：updateHistory(conversationId, onSystemMessage)

###### 用途：检查是否需要压缩历史上下文

##### 失败分支：failPendingMessage(id)

###### 更新：assistant 消息 status=FAILED

##### finally：withConversationLock 释放会话锁

#### 后端：ChatService.streamModelResponse()

##### 读取：ConfigService.getOrThrow('BASE_URL'、'API_KEY'、'MODEL')

##### 请求：POST {BASE_URL}/chat/completions，stream=true

##### 处理：response.body.getReader() 持续读取

##### 解析：提取 choices[0].delta.content

##### 回调：onChunk(delta)

##### 返回：fullAnswer 完整文本

#### 前端接收 SSE

##### response.body.getReader()

##### TextDecoder 解码字节

##### flushTyping()

###### 用途：以打字机效果显示 pendingText

##### recordAssistantMessage(conversationId, receivedText)

###### 用途：把完整 AI 回复写入前端本地状态

##### recordSystemMessage(conversationId, message)

###### 用途：记录“系统已自动压缩历史上下文”

##### setSendingState(false)

## 用户发送消息：非流式接口

### 调用入口

#### HTTP：POST /api/chat

#### 后端：ChatController.chat(body)

##### 调用：ChatService.getAIResponse(conversationId, message)

#### 后端：ChatService.getAIResponse()

##### withConversationLock()

##### createPendingMessages()

##### askAI()

###### 内部调用：getHistory() → callModel()

##### completePendingMessage()

##### updateHistory()

##### 返回：完整 answer

#### 后端：ChatService.callModel()

##### 用途：调用非流式 AI 接口

##### 请求：POST {BASE_URL}/chat/completions

##### 返回：data.choices[0].message.content

## 用户删除会话

### 用户动作：点击会话旁的“删除”

#### 前端方法：deleteConversation(conversationId)

##### 用途：记录待删除会话并打开确认弹窗

#### 用户动作：点击“确认删除”

#### 前端方法：confirmDeleteConversation()

##### 调用：performDeleteConversation(conversationId)

#### 前端方法：performDeleteConversation(conversationId)

##### HTTP：DELETE /api/chat/:conversationId

##### 成功：从 conversations 数组移除、重新选择会话、saveState()

#### 后端：ChatController.deleteChatHistory(conversationId)

##### 调用：ChatService.deleteHistory(conversationId)

#### 后端：ChatService.deleteHistory(conversationId)

##### 用途：软删除会话

##### 数据库：PrismaService.conversation.updateMany()

##### 条件：id 匹配且 deletedAt 为 null

##### 更新：deletedAt = 当前时间

## 用户点击账户 / 登录占位

### 用户动作：点击账户按钮

#### 前端方法：openAccountDialog()

##### 用途：打开登录弹窗并清空反馈

### 用户动作：提交登录表单

#### 前端方法：handleAccountSubmit(event)

##### 当前行为：阻止默认提交，显示“登录接口将在后端认证完成后接入”

##### 当前没有调用后端登录接口

## 前端辅助方法

### openSidebar / closeSidebar / toggleSidebar

#### 用途：控制移动端会话侧栏和遮罩层

### renderConversationList

#### 用途：创建会话选择按钮和删除按钮

### renderMessages

#### 用途：根据 role 和 status 生成消息 DOM

### startThinkingAnimation / stopThinkingAnimation

#### 用途：控制 AI 思考中的动画文字

### startPendingRefresh / stopPendingRefresh

#### 用途：每 1 秒重新读取消息，发现 PENDING 变为 COMPLETED 或 FAILED 后刷新页面

### getConversation

#### 用途：按 ID 从内存会话列表查找会话

### formatTime

#### 用途：把时间显示为当天时分或月日

### setSendingState

#### 用途：统一控制发送按钮、输入框和会话操作状态

### addMessage

#### 用途：向聊天区域追加一条消息 DOM

## NestJS 启动和依赖注入

### main.ts：bootstrap()

#### NestFactory.create(AppModule)

#### app.useStaticAssets('public')

#### app.listen(3000)

### AppModule

#### 用途：装配全局配置、认证模块和聊天模块

#### ConfigModule.forRoot()

##### Joi 校验 API_KEY、BASE_URL、MODEL、DATABASE_URL、DEV_USER_ID

### AuthModule

#### 用途：装配 AuthController 和 AuthService

#### 导入 PrismaModule

### ChatModule

#### 用途：装配 ChatController 和 ChatService

#### 导入 PrismaModule

### PrismaModule

#### 用途：提供 PrismaService 给 AuthService 和 ChatService

### PrismaService

#### 用途：继承 PrismaClient，连接 PostgreSQL

#### onModuleInit()

##### 调用条件：NestJS 应用启动

##### 动作：$connect()

#### onModuleDestroy()

##### 调用条件：NestJS 应用关闭

##### 动作：$disconnect()

## 注册流程

### 用户动作：POST /api/auth/register

#### AuthController.register(body)

##### 调用：AuthService.register(input)

#### AuthService.register(input)

##### 清理：邮箱 trim + 转小写，显示名称 trim

##### 校验：邮箱格式、密码至少 8 位、名称 1 到 8 字符

##### 调用：hashPassword(password)

###### randomBytes(16) 生成 salt

###### scrypt 生成密码摘要

##### 调用：PrismaService.user.create()

##### 成功：只返回 id、email、displayName、createdAt

##### 冲突：isUniqueConstraintError(error) 判断 P2002，然后抛出邮箱已注册

## Session 登录态完整请求流程

### 一、登录并创建 Session

#### 用户动作：提交登录表单

##### 前端事件：accountForm submit

##### 前端方法：handleAccountSubmit(event)

###### 调用：FormData(accountForm) 读取 email 和 password

###### 请求：POST /api/auth/login

###### Body：{ email, password }

#### 后端入口：AuthController.login(body, request)

##### 调用：AuthService.login(body)

###### 查询：PrismaService.user.findUnique({ where: { email } })

###### 调用：verifyPassword(password, user.passwordHash)

###### 失败：邮箱不存在、密码错误或输入非法，抛 UnauthorizedException；后续 Session 不创建

##### 调用：request.session.regenerate()

###### 用途：登录成功后轮换 Session ID，避免 Session fixation

##### 写入：request.session.userId = user.id

##### 返回：公开用户资料，不包含 passwordHash

#### express-session 中间件自动保存

##### 触发：login 方法修改 request.session 后，响应结束前

##### 调用：PrismaSessionStore.set(sid, sess)

###### 读取：sess.userId 和 sess.cookie.expires

###### 序列化：JSON.stringify(sess)

###### 写入：PrismaService.session.upsert()

###### 数据库：sessions 表，保存 sid、userId、data、expiresAt

##### 响应头：Set-Cookie: elara.sid=签名后的 Session ID

###### Cookie 属性：HttpOnly、SameSite=Lax、生产环境 Secure、Max-Age=7天

#### 前端登录成功处理

##### 浏览器自动保存 elara.sid Cookie，JavaScript 无法读取 HttpOnly 值

##### 设置 currentUser

##### 调用 loadConversationsFromServer()

##### 调用 createConversation()（该用户没有会话时）

##### 调用 saveState()、renderConversationList()、renderActiveConversation()

### 二、页面初始化时恢复登录态

#### 用户动作：打开网页或刷新页面

##### 前端顶层初始化调用 getCurrentUser()

##### 请求：GET /api/auth/me

##### 浏览器自动携带 elara.sid Cookie

#### express-session 中间件

##### 从 Cookie 解析 sid

##### 调用：PrismaSessionStore.get(sid, callback)

###### 查询：PrismaService.session.findUnique({ where: { sid } })

###### 过期条件：expiresAt <= 当前时间

###### 过期分支：PrismaService.session.delete()，返回 null

###### 有效分支：把 data 恢复成 request.session，继续进入 Controller

#### SessionAuthGuard.canActivate(context)

##### 读取：request.session.userId

##### 有 userId：返回 true，允许 AuthController.me 执行

##### 没有 userId：抛 UnauthorizedException('请先登录')，Controller 和 Service 不执行

#### AuthController.me(request)

##### 调用：AuthService.getPublicUser(userId)

##### 查询：PrismaService.user.findUnique()，只取公开字段

##### 返回：currentUser 用户资料

#### 前端继续加载数据

##### currentUser 存在：调用 loadConversationsFromServer()

##### currentUser 不存在：不创建会话，等待用户打开登录框

### 三、已登录用户访问聊天和会话接口

#### 用户动作：新建会话、切换会话、发送消息或删除会话

##### 浏览器自动给 fetch 请求携带 elara.sid Cookie

#### express-session 中间件

##### 调用 PrismaSessionStore.get(sid)

##### 恢复 request.session.userId

##### rolling=true：有效请求可能触发 PrismaSessionStore.touch(sid, sess)

###### 更新：sessions.expiresAt，延长 7 天登录有效期

#### SessionAuthGuard.canActivate()

##### 有效 Session：允许 ChatController 进入方法

##### 无效 Session：直接返回 HTTP 401，ChatService 不执行

#### ChatController 使用身份

##### createConversation() → ChatService.createConversation(request.session.userId)

##### getConversations() → ChatService.getConversations(request.session.userId)

##### getConversationMessages(id) → ChatService.getConversationMessages(id, request.session.userId)

##### chat(body) → ChatService.getAIResponse(id, message, request.session.userId)

##### chatStream(body) → ChatService.streamAIResponse(id, message, request.session.userId, onChunk, onSystemMessage)

##### deleteChatHistory(id) → ChatService.deleteHistory(id, request.session.userId)

#### ChatService 权限过滤

##### Conversation 查询统一增加 userId 条件

##### Message 查询通过 conversation.userId 检查归属

##### createPendingMessages() 在事务内先确认 id + userId + deletedAt=null

##### 其他用户的会话：查询不到或 updateMany.count=0，不读写其数据

### 四、退出登录

#### 用户动作：点击退出登录

##### 前端请求：POST /api/auth/logout

##### 浏览器自动携带 elara.sid Cookie

#### SessionAuthGuard.canActivate()

##### 校验当前 Session，未登录则返回 HTTP 401

#### AuthController.logout(request, response)

##### 调用：request.session.destroy()

#### express-session 调用：PrismaSessionStore.destroy(sid)

##### 数据库：PrismaService.session.deleteMany({ where: { sid } })

#### AuthController 清除 Cookie

##### 调用：response.clearCookie('elara.sid')

##### 返回：{ loggedOut: true }

#### 后续请求

##### 浏览器不再携带有效 Session

##### SessionAuthGuard 拒绝聊天和会话接口

### 五、Session 文件职责和调用关系

#### src/main.ts

##### 用途：应用启动时注册 express-session 中间件、Cookie 规则和 PrismaSessionStore

#### src/auth/auth.controller.ts：AuthController

##### 用途：登录成功后写入 request.session.userId；提供 /me 和 /logout

#### src/auth/auth.service.ts：AuthService

##### 用途：验证邮箱密码、查询公开用户；不直接保存 Session

#### src/auth/session-auth.guard.ts：SessionAuthGuard

##### 用途：Controller 执行前检查 request.session.userId

#### src/auth/prisma-session.store.ts：PrismaSessionStore

##### 用途：实现 express-session 的 get、set、touch、destroy，并映射到 PostgreSQL

#### src/auth/express-session.d.ts

##### 用途：告诉 TypeScript SessionData 有 userId 字段

#### prisma/schema.prisma：Session

##### 用途：定义 sid、userId、data、expiresAt 和用户外键

## 当前仍待完善的链路

### 登录按钮

#### 前端已有弹窗和 handleAccountSubmit()

#### 登录接口和 Session 基础链路已接入；前端注册、登录态展示和退出按钮已接入

### 前端注册流程

#### 用户动作：点击账户按钮

##### 前端方法：openAccountDialog()

###### 未登录：调用 showAccountForm()，显示登录/注册切换和登录表单

###### 已登录：调用 showLoggedInAccount()，显示用户资料和退出按钮

#### 用户动作：点击“注册”切换按钮

##### 前端方法：setAccountMode('register')

###### 显示 displayName 字段，设置 maxlength=8 和 required

###### 修改提交按钮文字为“注册”

#### 用户动作：提交注册表单

##### 前端方法：handleAccountSubmit(event)

###### 读取：displayName、email、password

###### 请求：POST /api/auth/register

###### Body：{ displayName, email, password }

#### 后端：AuthController.register(body)

##### 调用：AuthService.register(input)

##### 成功：返回公开用户资料，不自动创建 Session

##### 失败：返回邮箱重复、邮箱格式错误、密码过短或名称超过 8 个字符

#### 前端注册成功

##### 显示“注册成功，请使用新账户登录”

##### 清空表单

##### 调用 setAccountMode('login')

##### 用户随后提交登录表单，进入 Session 登录流程

### 前端登录态展示流程

#### 页面初始化

##### 调用 getCurrentUser()

##### currentUser 有值：updateAccountButtons() 显示昵称和头像首字

##### currentUser 为空：显示“未登录 / 登录以同步会话”

#### 登录成功

##### handleAccountSubmit() 保存 currentUser

##### 调用 loadConversationsFromServer()

##### 没有会话：调用 createConversation()

##### 调用 renderConversationList()、renderActiveConversation()、updateAccountButtons()

#### 已登录账户按钮

##### 调用 openAccountDialog()

##### 调用 showLoggedInAccount()

##### 显示 displayName、email 和“退出登录”按钮

### 前端退出登录流程

#### 用户动作：点击“退出登录”

##### 前端方法：handleLogout()

###### 请求：POST /api/auth/logout

###### 浏览器自动携带 HttpOnly Cookie

###### 后端删除 Session 并清除 Cookie

##### 前端成功处理

###### currentUser = null

###### conversations = []，activeConversationId = null

###### stopPendingRefresh()

###### 清空 messagesDiv

###### saveState()、renderConversationList()、updateAccountButtons()

###### 关闭账户弹窗，页面回到未登录状态

##### 前端失败处理

###### 保留当前登录态

###### accountFeedback 显示退出失败原因

### 正式用户隔离

#### HTTP 接口已经使用 Session 中的 userId

#### DEV_USER_ID 只保留给旧单测或内部直接调用 ChatService 的兼容默认值

### 剧情系统

#### Elara 人格、记忆、好感度、信任度、谜题和结局尚未进入调用链
