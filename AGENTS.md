# AGENTS.md

本仓库是微信小程序学习工具项目（代号 Learn）的设计与开发仓库，已进入开发阶段。本文件约定仓库内的工作方式与必须遵守的边界；详细规则、实施进度和验证证据由对应文档维护。

## 1. 开始工作

1. 接手先读 [DEVELOPMENT_HANDOFF](docs/DEVELOPMENT_HANDOFF.md) 和 [ROADMAP](docs/ROADMAP.md)，了解当前实现及下一步；不要把已有纯 TS 格线、部分文字布局或目录规划当作完整产品。
2. 修改前读 [DECISIONS](docs/DECISIONS.md) 和本次涉及的主题文档，再检查对应源码与测试；不要根据 README 猜测业务规则。
3. 先检查工作区已有修改，保留与当前任务无关的改动；围绕当前任务修改，避免顺手扩大范围。
4. 已确认规则直接执行，可独立验证的技术细节按验收标准推进，无须逐项请求确认。新的产品取舍须先提出决策；未确定项不自行当作需求，也不因尚有待验证项而停止所有独立开发工作。

## 2. 产品范围与架构边界

- **界面规范**：按 D-039 使用微信原生基础组件与少量自定义业务组件。页面、菜单、布局和样式先按 [UI_DESIGN](docs/UI_DESIGN.md) 评审，修改前读前端 spec；不逐页自行引入 UI 库或另造样式体系，具体草案未确认前不当作已冻结需求。
- **首版范围**：微信原生小程序、关联 CloudBase、四种固定 A4 竖版纸张、正式导出仅 PDF；每模板面向用户只有一个当前默认规格。不要自行增加第二套排版策略、规格选择或未确认的调节项。
- **控制复杂度**：不主动引入 AI/OCR、自建服务器、EdgeOne、独立 Web 管理后台、微服务框架、大型 CMS 或通用插件框架。DOCX 留待后续需求，禁止拿截图嵌入 DOCX 冒充可编辑 Word。
- **依赖方向**：通用账户/权益/统计与纸张工具分开；格线、通用文字布局、渲染和云端业务编排分层。纸张核心不依赖微信 API、CloudBase、Node 文件系统或具体渲染器。
- **排版与版本**：小程序和云端共用排版源码，本地预览、云端复算；内核、预设及字体/度量资源必须按同一版本组合核对。Canvas/PDF 不自行决定换行和分页，客户端不覆盖可信预设。完整规则见 [ARCHITECTURE](docs/ARCHITECTURE.md)。
- **小程序更新**：应用入口统一检查兼容性，页面共享结果，不逐页重复检查；提交生成仍由云端校验。代码通过微信正式更新机制发布，不能从云端下载 JS 执行热更新；不得在用户已有输入时直接强制重启。
- **纸张与字体**：几何数值和中心线/墨迹量测以 [PAPER_PRESETS](docs/PAPER_PRESETS.md) 为准，字体分配和文字规则以 [PAPER_ENGINE](docs/PAPER_ENGINE.md) 为准。不得为容纳正文或描边而移动、缩放既定格线；超长内容须续页或明确拒绝，不能静默丢字。

## 3. 云端信任、任务与隐私

- 用户身份从可信云端上下文取得；管理员权限、免费/广告/购买额度、扣次、记录及文件访问都由云端校验。客户端的用户 ID、角色、余额、支付状态、请求号或布局摘要均不能代替鉴权。
- 生成遵循 [DATA_AND_CREDITS](docs/DATA_AND_CREDITS.md) 的请求幂等、额度预留及事务结算规则：成功才扣次，失败释放预留，终态不反转；同次请求重试及同一任务有效期内重复下载不重复消费。前端请求号用于去重，云端任务号用于查询，两者不能当作访问凭据。
- 云端受理后的任务独立于页面运行，用户从生成记录查看进度与结果。客户端断网、离页或等待超时不等于任务失败；可靠执行交接及对账须按 [CLOUDBASE](docs/CLOUDBASE.md) 实测，不能依赖页面存活或函数返回后未等待的异步代码。
- 默认不持久化作文正文，不为自动重试保存原文或含原文的布局快照；恢复只处理状态、已有 PDF 和账本，不自动重新排版。失败后由用户需要时重新粘贴提交。
- 日志、统计和错误上报不得记录正文、含原文的布局数据或敏感凭据。生成记录、参数指纹与私有 PDF 各按对应规则管理；不得把历史查询变成原文归档，也不得把文件标识或链接视为授权本身。

## 4. 验证与交付

- 按 [TESTING](docs/TESTING.md) 运行与改动相关的检查。修改纸张内核时，在 `packages/paper-core` 运行 `npm test`（包含编译）；缺少依赖时先 `npm install`。历史测试记录不能替代本次验证。
- 涉及版式的修改必须更新布局基准并验证打印效果。几何测试、实际墨迹边界和实体打印分别验收；中心线坐标正确、截图正常或占位字体 PDF 可打开，都不代表打印验收通过。
- 未实际验证的 API、平台能力、跨端兼容、字体授权及打印效果明确标为待验证。暂时无法验证时记录原因和剩余验收项，不写成已通过；设计确认、代码完成和验收通过必须区分。
- 仅文档修改检查差异、引用和前后规则一致性；不要将文档定稿描述为功能实现。交付说明写清修改内容、实际完成的验证与尚未验证的部分。

## 5. 决策与文档维护

- 已确认决策以 [DECISIONS](docs/DECISIONS.md) 为准；纸张物理规格及量测定义以 [PAPER_PRESETS](docs/PAPER_PRESETS.md) 为唯一来源。发现冲突时先按这些来源核对，不另造折中规则；涉及新的产品取舍再提交 Owner 确认。
- 新决定先更新 `DECISIONS.md` 的状态、理由和验证条件，再修改对应权威规范，同步受影响的引用、验收项及实施进度。
- 每个主题只维护一处详细说明，其他文档引用它；直接修正冲突或过时段落，不在旧文末尾堆“补充说明”。AGENTS.md 不复制字体表、物理数值、状态机或完整决策清单。

## 6. 按任务查阅文档

| 文档 | 内容 |
|---|---|
| [DEVELOPMENT_HANDOFF](docs/DEVELOPMENT_HANDOFF.md) | 接手顺序、冻结范围及剩余工程 |
| [ROADMAP](docs/ROADMAP.md) | 当前进度、下一步与里程碑 |
| [DECISIONS](docs/DECISIONS.md) | 已确认决策、待讨论/待验证项及排除方案 |
| [PRODUCT](docs/PRODUCT.md) | 用户流程、页面、生成记录与首版范围 |
| [UI_DESIGN](docs/UI_DESIGN.md) | 组件策略、页面/菜单/布局、视觉规范及评审状态 |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | 依赖边界、共享代码、版本匹配与更新流程 |
| [PAPER_PRESETS](docs/PAPER_PRESETS.md) | 固定物理规格、中心线/墨迹及打印安全定义 |
| [PAPER_ENGINE](docs/PAPER_ENGINE.md) | 文档模型、文字规则、字体分配和渲染契约 |
| [DATA_AND_CREDITS](docs/DATA_AND_CREDITS.md) | 身份、额度、任务状态机、幂等、恢复与隐私 |
| [CLOUDBASE](docs/CLOUDBASE.md) | 环境、部署、云端执行与访问安全 |
| [TESTING](docs/TESTING.md) | 验收标准、回归样例及验证证据 |
<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->
