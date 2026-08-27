# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

NestJS + TypeScript backend with a static HTML/CSS/JavaScript frontend served from `public/index.html`.

## Users

主要用户是希望直接与 AI 对话的普通网页用户。

项目作者也会把它作为展示 Agent 工程能力的个人作品，用于求职作品集和面试介绍。

## Product Purpose

这是一个 AI 对话网站。用户可以像使用普通聊天应用一样向 AI 提问并获得回答。

产品还会隐藏一个点击触发的剧情彩蛋：触发后，AI 将扮演一个 NPC，用户通过对话提升 NPC 好感度并完成目标。

## Positioning

产品将普通 AI 对话和可探索的 NPC 剧情体验放在同一个聊天入口中，让用户先获得自然的工具体验，再逐渐发现隐藏的叙事玩法。

## Operating Context

用户在浏览器中输入消息、发送请求，并在聊天区域阅读 AI 回复。当前项目通过本地 NestJS 服务提供网页和聊天接口。

## Capabilities and Constraints

- 当前已有普通 AI 聊天功能。
- 当前聊天接口支持服务端流式响应，前端负责解析响应并逐字符展示。
- 后续计划增加 NPC 角色状态、好感度、任务目标和通关判断。
- 当前阶段只进行前端视觉设计和交互体验调整，不修改后端聊天接口。
- UI 需要为未来的普通聊天模式和 NPC 剧情模式提供共同的视觉容器。
- 未决定后续是否引入前端框架、数据库、登录系统或更复杂的 Agent 编排能力。

## Brand Commitments

用户明确提出的视觉方向：

- 暗色童话
- 手绘感
- 纸页、卡面、UI 插页的质感
- 轻微怪诞，但不恐怖
- 整体颜色偏暗、偏暖，并使用少量高对比点缀

这些视觉约束需要让普通聊天界面和未来剧情彩蛋保持统一，而不是让彩蛋看起来像完全独立的网站。

## Evidence on Hand

- 当前网页入口：`public/index.html`
- 当前后端聊天模块：`src/chat/`
- 当前项目已有可运行的 AI 对话功能。
- 目前没有可作为品牌依据的正式 Logo、插画资产、用户数据或产品宣传材料，后续工作不得虚构这些证据。

## Product Principles

- 先保证普通聊天清晰、可靠、易用，再让彩蛋成为可发现的额外体验。
- 普通模式和剧情模式共享核心聊天习惯，降低用户学习成本。
- 视觉个性服务于沉浸感和记忆点，不牺牲消息阅读与输入效率。
- 关键的 Agent 行为和剧情状态应逐步变成可解释、可测试的产品能力。

## Accessibility & Inclusion

当前没有额外确认的产品专属无障碍标准。后续前端设计至少需要保持清晰的文字对比度、键盘可操作性和窄屏可用性。
