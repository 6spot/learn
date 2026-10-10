# T22 原生运营页面阶段证据

2026-10-11；原生页面与会话逻辑已完成隔离独立检查，见 [frontend-check](frontend-check.md)。App 接线、全项目类型检查及官方模拟器集成仍待主会话组织，T22 不据此归档。

## 实现

- `miniprogram/pages/admin/index.{ts,wxml,wxss,json}`：P08 原生页面，上海日期 picker、主动刷新、双列统计、四模板成功数、覆盖与统计时间、拒绝访问/错误/加载状态。没有私有记录、分享截图、改余额或其他配置表单。
- `miniprogram/lib/admin-session.ts`：读取 App 的同一 CloudClient；只投影有限统计字段，校验日期/数值/覆盖/四模板一致性。零分母与数据缺口分别显示“暂无”和“不可用”；查询失败保留并标明原日期的成功汇总，撤权立即清空，离页丢弃迟到响应。
- `miniprogram/test/admin.test.mjs`：直接构建 ES2017 中性 bundle，VM 中没有微信之外的浏览器/Node 编码器或存储。使用实际 CloudClient 响应信封调用，另验证实际原生 Page 定义与生命周期。

## 本次验证

`node --test miniprogram/test/admin.test.mjs`：独立检查修复后 **12/12 通过**。

覆盖：服务器上海日期与统计时间、仅固定安全字段进入 page data、零分母/零计数、四来源缺口、重复请求共享、历史日期与今天之间的迟到响应、失败保留原日期数据、权限与账户撤销清空、无效/未来日期拒绝、跨午夜默认今天不锁定旧日期、坏成功响应安全拒绝、隐藏/卸载失效及原生生命周期、日期/刷新控件语义。

独立检查发现失败率只与计算值比较浮点误差，极小负值或略大于 1 的值可能落入误差容差并被显示为有效结果。新增回归先复现失败，再显式限制 `0 ≤ failureRate ≤ 1`；无分母和覆盖缺口仍保持 null 的不同展示语义。

`npx tsc -p tsconfig.json --noEmit`：本阶段唯一错误为 `pages/admin/index.ts` 所需 `LearnApplication.client` 尚未由 T19 接入。实现者没有通过类型断言、可选备用 transport 或修改他人 App 文件来掩盖缺失；root 已确认此接入点。其余新增源码无编译错误。接入后需重跑严格检查，不把当前结果称为全项目通过。

`git diff --check`：通过。源代码检查没有 console、持久存储或轮询计时器。

## 集成与未验收项

1. T19 为 `getLearnApp()` 提供 `client: CloudClient`，root 注册 `pages/admin/index`；T21 在 P04 按云端 `account.isAdmin` 显示入口。
2. 完成正式构建并以官方 DevTools 对真实本地内存服务验证普通用户拒绝、管理员汇总、日期/刷新与覆盖展示；共享 DevTools 本阶段未占用。
3. 本次独立检查仅覆盖隔离原生 UI；集成完成后重跑全项目严格检查与实际页面联调。真实 CloudBase 权限、索引/扫描预算、生产配置及真机显示仍留 T24，VM 测试不替代它们。
