# T20 执行清单

## 启动条件

- [x] 核对 [PRD](prd.md)、[设计](design.md)、权威文档及本次工作区变更。
- [ ] 核对最终集成验收依赖（阶段入口见下文）：[T14 实现请求幂等与任务受理](../archive/2026-10/10-10-v1-job-admission/prd.md)、[T15 实现生成执行与事务结算](../archive/2026-10/10-10-v1-job-execution/prd.md)、[T19 实现应用级兼容与更新流程](../archive/2026-10/10-10-v1-miniapp-update/prd.md)、[T21 实现我的与生成记录页面](../10-10-v1-miniapp-records/prd.md)
- [x] 将技术未知项落实为可验证方案；安全随机 API 依据见 [研究](research/random-source.md)，本阶段接口/边界已由 root 评审。
- [x] 阶段 A 完成独立检查；root 在 T19 归档后启动阶段 B 并明确 App/T21、原生生成入口及 DevTools 分工。

- [x] 已读取 D-043 已接受的 T25 基线、UI_DESIGN 及前端组件/质量规范；阶段 B 接入两处已有生成按钮与原请求恢复操作。

## 分阶段交付

A：在 T14/T15 受理与 T19/T21 客户端接口明确后实现请求号、快照、重试；B：接真实服务并进入 T21 唯一的 P06。T21 提供详情视图/状态与查询，T20 不另建生成结果页；本任务最终验收依赖 T21 集成完成。

阶段输入与整项验收依赖以 [父任务总表](../10-10-learn-v1/task-map.md) 为准；只完成阶段不能将整项标记完成。

## 交付步骤

- [x] 验证随机源回调契约并建立一次操作的内存快照；实际 wx API 调用待原生集成。
- [x] 接入受理/查询及兼容错误交互；实际原生 Page/App 的 VM 测试通过。
- [x] 本地覆盖双击、参数变化、断网、跨编辑/预览重进及受理结果丢失；官方模拟器证据待 baseline 补充。

## 验收映射

- [ ] T20-AC1：微信可靠随机源生成请求号；双击及网络重试使用同号同参，主动新生成使用新号。
- [ ] T20-AC2：未确认受理不显示已开始；响应丢失先查原请求，不自动创建第二个任务。
- [ ] T20-AC3：客户端等待超时不判失败或退款；快照不默认持久化正文；输入修改不污染在途请求。

- [ ] T20-AC4：受理后进入 T21 所有的同一个 P06 详情，传递任务标识与来源导航，不以路由携带正文，也不另造结果页或任务状态机。

## 验证与收尾

- [ ] 按 docs/TESTING.md 对应章节执行模块与集成验证；创建模块后记录实际可运行命令，不预填不存在的 npm 脚本。涉及微信/CloudBase 的项目必须另有真实环境证据。
- [ ] 检查文档差异、相对引用及与 DECISIONS/PAPER_PRESETS 的一致性。
- [ ] 将本轮实际验证、失败原因与剩余项目记录到任务证据；必要时更新 TESTING/ROADMAP。
- [ ] 检查无正文、敏感凭据或未授权字体分发进入日志/提交。
- [ ] 独立检查通过后再标记完成，恢复/回退不得覆盖他人变更。

## 当前验收限制

云端请求/任务号只是查询线索，所有查询仍须鉴权。

### 阶段 A 交付（2026-10-11）

- [x] 新增 portable generation-session 与 secure-random 及其测试，保留其他任务的修改。
- [x] 真实预览完成前校验 revision，完成后冻结输入/选项/版本/摘要；双击合并，固定整号重试，明确新生成才换号。
- [x] 未知响应先查原号；本地超时不判失败；晚到提交/查询可恢复 known；clear 阻止旧回调发送、回写和导航。
- [x] 核对任务与请求/模板/状态配对；安全 view 不暴露正文、布局或请求号。
- [x] `node --test miniprogram/test/secure-random.test.mjs miniprogram/test/generation-session.test.mjs` 24/24；`./node_modules/.bin/tsc -p tsconfig.json` 通过。
- [x] 阶段 A 独立检查修复随机值品牌校验与 API 属性异常边界，修复后 25/25、模块严格类型检查通过；[session-check.md](session-check.md) 记录后续共享 T21 类型接入和阶段 B 边界。
- [x] 实际 CloudClient + CloudService 响应丢失验证原任务一次渲染、一次扣费；详细来源及限制见 [证据](evidence.md)。
- [x] 阶段 B：App 注册会话/清理，编辑与预览原生按钮区分 retry/startNew，导航至 T21 唯一 `/pages/records/detail?jobId=...`。
- [ ] 阶段 B：原生模拟器覆盖双击、离页、重进、响应丢失与文件交付，再完成独立检查及整项验收。

### 阶段 B 本地交付（2026-10-11）

- [x] editor-environment 持有唯一真实 GenerationSession；application 只替换 generation 类型并保留 T21 records；集中清理先撤销生成回调再清空编辑/兼容/字体与其余所有者。
- [x] 只有当前 revision 的 Canvas display 成功且应用兼容通过时启用生成，busy/未知结果阻止新操作；两页共享安全字段与原号 query/retry。
- [x] known 后下一次主按钮明确“再次生成 PDF”；改文后的旧请求重试提示继续使用上次内容；不将完整请求号/正文加入导航。
- [x] 离页清理订阅/画布/本页可见 token；云端继续。结果导航需 App 前台、有效 token 与匹配的顶层路由，返回前台不补跳；known 可从记录查看。
- [x] typecheck/build 通过；生成专项 32/32、兼容/编辑/隐私/运行时 61/61、Canvas 22/22，来源与初次失败说明见 [证据](evidence.md)。
- [x] 阶段 B 独立检查修复后台路由残留导致的晚到跳转，源码/隐私/Canvas 与统一构建后的 emitted 回归合计 119/119、全项目 tsc 通过；详见 [final-check.md](final-check.md)。
- [ ] 官方模拟器整合由 root/baseline 继续；不提前归档。

T20-AC1/2/3 已覆盖会话机制与 emitted 原生页面的本地行为；AC4 已真实调用唯一详情路由且只传 jobId，T21 页面及官方模拟器全链路按协调者证据继续。真机/CloudBase/组件配置仍留最终 Owner 验收。
