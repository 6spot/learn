# T21 原生记录阶段证据

2026-10-11，P04/P05/P06 与 App 集成及源码独立检查已完成。官方模拟器由 baseline 单独验证并交 root 汇总；本任务尚未归档，真机验收仍独立保留。

## 已实现文件

- `record-data.ts`、`record-sessions.ts`、`record-environment.ts`：安全账户/任务投影，单 App 文件所有者，前台且可见的未终态轮询，有限分页与清理。
- `pages/records/index.*`、`pages/records/detail.*`：原生倒序记录列表与唯一结果详情，保留最后已知状态的查询失败提示、当前有效查询才允许领取、有效/过期/不可用文件与失败原因、当前内存编辑返回。
- `miniprogram/test/records.test.mjs`：独立 ES2017 VM 会话/原生 Page 与既有实际下载器组合。
- `app.ts/application.ts/app.json`：App 启动只创建一个 records 所有者，注册清理及前后台通知，新增唯一列表/详情路由，保留已接入的 privacy/admin 路由。application.ts 的 generation 类型由 T20 同步维护，未覆盖其修改。
- `pages/me/index.*`：真实额度与失败保留提示、批准顺序的记录/微信反馈/隐私菜单、仅本次云端确认后显示的管理员分组；P04 输入不含用户身份、文章或请求号。

## 本次验证

`node --test miniprogram/test/records.test.mjs`：**17/17 通过**。这是本任务完成 App/P04 接入后的实现者运行；最后的 T20 合并状态交独立检查再验。

覆盖可信余额投影及失效管理员入口、3 个分页响应预算与非空游标、空/短页继续加载、分页失败保留旧列表、重复游标拒绝、较早已加载任务的定向轮询、每轮最多 5 个 pending 的轮转、15 秒错误退避与前后台停止、隐藏/隐私清理后迟到回包、排队账户请求在清理后不新建账户、六类详情状态、查询失败禁用领取、重复下载共享、离页重进的下载 busy 释放、过期/不存在/坏响应、撤权统一清理且停止轮询、实际 SHA-256/文件写入/native-open 流程、全部 session 先清后传播本地删除失败、唯一路由与回退、无正文/请求号泄漏、成功主按钮位于信息之前。

最后新增实际 App + P04 回归：只在启动构造一个下载器，多个 onShow 只发一份账户读取，管理员操作不能依靠伪造 page data，App 后台取消轮询、前台刷新，集中清理同时移除编辑内容与所有记录视图。另核对 P04 菜单顺序与四个服务页面的路由唯一性。

实际下载器组合的首次测试发现测试为独立 bundle 创建不同 VM 全局，导致客户端字节不满足下载器的 `instanceof Uint8Array`；改为共享原生宿主应当共有的二进制构造器后通过。没有修改生产字节校验或把失败当作微信兼容证据。该测试中的文件系统与阅读器 API 仍为宿主替身，实际 PDF/平台文件操作由独立集成及最终设备验收覆盖。

`npm run typecheck`：App/P04 接入后完整通过，此前缺失的 App.records 错误已关闭。随后共享构建碰到 T20 正在写入 editor-environment 的短暂中间态而失败，紧接的全前端测试也因缺少生成产物而失败；这些失败不计作有效通过记录。双方随即协调构建所有权，T20 完成修改并于本轮报告合并状态的 `npm run typecheck` 与 `npm run build` 全部通过；root 安排独立检查者在该稳定产物上运行 records/privacy/admin，不重复由实现者刷同一套检查。

`git diff --check`：通过。未使用 DevTools，未修改后端、云传输或编辑/预览生成逻辑；真实生成与 App.records 共享同一个 client。

## 独立检查复核

- 修复详情已成功查询后，PDF领取返回NOT_FOUND/RECORD_EXPIRED仍保留旧打开按钮的问题；账户撤权并完成集中清理后也保留明确错误提示，不停在idle加载标题。只清除本地领取资格，不更改云端终态或账目。
- 增加1项含6种失效错误码的回归，先复现错误地保持ready，再验证修复后error/null record/canOpen=false及正确的全账户撤权范围。
- 增加1项实际下载器集成：清理时PDF写入尚未完成且账户/列表/详情查询均在途，先安全提示清理未完成，迟到回包不恢复旧视图，迟到写入被删除且不打开阅读器，后续严格清理重试成功。
- `node --test miniprogram/test/records.test.mjs miniprogram/test/privacy.test.mjs miniprogram/test/admin.test.mjs` **46/46**：records19、privacy15、admin12。`./node_modules/.bin/tsc -p tsconfig.json`完整通过。MJS语法及定向差异检查通过。
- 本轮未运行构建/DevTools，baseline独占该验证。App/application审核未需修改；随后T20新增的后台/页面可见导航守卫由stats_check独立复核，不以此处类型检查覆盖其后续改动。
- 新增并索引 `.trellis/spec/frontend/records-account.md`。日志 `/tmp/learn-t21-check.log`、`/tmp/learn-t21-typecheck.log`；详见 [check.md](check.md)。

## 未完成部分

1. root汇总T20后台导航守卫与T21的最终合并类型检查及构建；T21检查者已释放全部源码。
2. baseline 统一用官方模拟器验证真实本地服务的列表、状态、领取、权限、清理与 T20 导航，控件 ID 和 API 已交接。
3. 真实 CloudBase、手机 PDF 阅读器/文件清理/微信反馈及实体打印保持 T24 外部验收项。
