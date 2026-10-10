# T22 原生管理员页面独立检查

2026-10-11，reviewer：`foundation_check`。范围：`miniprogram/pages/admin/*`、`lib/admin-session.ts`、`test/admin.test.mjs` 和本任务前端证据。没有修改 App/application、路由、我的页面、公共传输或后端，也未操作 DevTools。

## Findings (fixed)

- File: `miniprogram/lib/admin-session.ts`, `miniprogram/test/admin.test.mjs`
  - Issue: 失败率校验只比较与计算结果的浮点误差，`-Number.EPSILON` 或 `1 + Number.EPSILON` 可落入允许误差，导致超出合法范围的服务响应被视为有效数据；极小负值可显示为 `-0.0%`。
  - Fix: 在误差核对前独立限制失败率为闭区间 `[0, 1]`。新增回归先复现失败，修复后 12 项测试全部通过。零分母的“暂无”和缺口的“不可用”保持原语义。

其余受审路径未发现需要修改的局部实现缺陷：只调用 App 的既有客户端；按服务器上海日期/统计时间展示；历史与今天请求隔离、同请求合并；缺口指标不当作零；失败保留并标明原日期汇总；鉴权/账户失效清空指标；隐藏/卸载丢弃迟到响应且无页面轮询。P08 只展示安全聚合字段，未引入敏感记录、分享截图、余额编辑或 CMS。

## Findings (not fixed)

- `miniprogram/pages/admin/index.ts:16` 当前引用的 `LearnApplication.client` 尚未由 T19 接入，全项目严格类型检查仍有唯一 TS2339。主会话已分配接线责任；本检查不修改共享接口、不加断言或备用客户端掩盖缺口。
- 路由注册、P04 管理员入口、App 云客户端及真实本地服务到原生页面的完整联调由集成任务完成。本轮没有 DevTools/真机视觉证据；CSS、原生日期选择和服务器权限在最终环境仍需对应验证。T22 不因隔离检查而标记整项完成。

## Verification

- Lint: 仓库未配置独立 lint；`node --check miniprogram/test/admin.test.mjs`、`git diff --check` 通过。
- TypeCheck: `./node_modules/.bin/tsc -p tsconfig.json` **未通过**，唯一错误为上述已知 App.client 接线缺口；没有其他新增类型错误。
- Tests: `node --test miniprogram/test/admin.test.mjs` **12/12 通过**，使用 ES2017 中性 bundle、实际 CloudClient 协议及原生 Page 生命周期的隔离 VM。
- Scope: 未重跑已独立检查的后端统计测试，未改公共集成文件、DevTools 或开发产物，无提交/归档。
