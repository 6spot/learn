# T22 设计与接口

2026-10-11：D-049 已确认，root 接受以下 API 与 coverage 方案。行为缺口是为已有安全原始记录提供可信管理员汇总；代码位于 `packages/cloud-service`，原生页面另由前端负责。

## 后端实现边界

- `contracts.ts/config.ts/service.ts` 增加显式 stats 配置与 `getAdminStats({date?})`；`stats.ts` 拥有扫描、机器字段验证和聚合；`stats-coverage.ts` 拥有无个人标识的覆盖控制；`stats-date.ts` 共享上海日期计算，activity 写入调用同一函数。
- `users.createdAt` 计新增，`daily_activity` 计有效 DAU，`generation_jobs.finishedAt` 计成功/失败与成功模板数，`credit_ledger.CONSUME` 计消费。每页按 ID 续接；显式全局扫描/软时间预算超限报错，不返回半份指标。
- 新生成的 DAU 与首次 RESERVED 受理在同一事务写入；准备失败仍是有效受理，准备跨午夜不会另建次日事件，受理回滚没有活动。有效 PDF 首块领取才可记下载活动。
- 用户、activity 和 job/settlement 主键必须和安全字段吻合；错误只返回固定机器码。无正文、标题、文件标识或用户记录进入统计响应。
- 每次调用可信鉴权，完成前事务复查 active 管理员并写安全 `STATS_READ` 审计。现有预设配置写入沿用原子审计，不增加任意余额修改、支付、Web 后台或 CMS。

## 对外契约

配置 `stats: {coverageStartDate,pageSize,maxScanRecords,maxRunMs}` 全部显式提供；日期严格为 2000–9999 年有效 `YYYY-MM-DD`，pageSize 1–100，maxScanRecords 1–1,000,000，maxRunMs 为正安全整数且不超过 10,000,000,000。

`getAdminStats({date?})` 默认服务器上海当日，不允许未来日期。响应包含 date、timeZone、period startsAt/endsAt、generatedAt、coverage（complete/sourceStarts/gaps）、metrics（newUsers/dau/succeeded/failed/failureRate/creditsConsumed）、四模板 templates（templateId/succeeded）和 scan（recordsRead/pagesRead）。指标缺来源时返回 null；无终态分母时 failureRate 为 null。精确 TS 类型以包 contracts 为准，README 给使用说明。

generatedAt 是本次聚合开始时间；筛选事件时间不晚于它且在所选自然日内。分页读取不是数据库跨查询快照；并发提交可能在下一次刷新才可见，不声称时间点强一致。

## 清理与覆盖

`stats_coverage/state` 保存递增 revision 与 users/activity/jobs/credits 的 floors；有效 sourceStarts 为配置起点和该来源 floor 的较晚者。`stats_coverage_gaps/<source>_<YYYYMMDD>` 只保留 source/date/reason/markedAt，无个人标识。

内部事务原语在删除有关安全记录的同一事务先标记 source/day 缺口，或在自然保留清理前单调推进 floor。T23 必须调用这些原语，不保留永久个人事实；floor 以下缺口可清理。查询开始事务读取 state 与当日四个 gap，完成事务检查 revision；并发覆盖变化报 STATS_CHANGED 要求刷新。

## 验证与限制

单元/模拟集成覆盖时区边界、重试与分块幂等、零分母、成功模板、超过100项分页、扫描/时间预算、管理员禁用、坏元数据、覆盖缺口与并发 revision。真实 CloudBase 权限、索引、扫描成本、配置及告警留 T24；UI 未完成前不将 T22 整项归档。

业务权威：[DATA_AND_CREDITS](../../../docs/DATA_AND_CREDITS.md#6-统计口径)、[PRODUCT](../../../docs/PRODUCT.md)、[UI_DESIGN](../../../docs/UI_DESIGN.md)、[CLOUDBASE](../../../docs/CLOUDBASE.md)、[TESTING](../../../docs/TESTING.md)。
