# T22 后端证据（2026-10-11）

本轮 backend 工作在 `packages/cloud-service`；服务端原始业务代码与内存事务/私有存储组合验证，没有部署 CloudBase。

- `npm --prefix packages/cloud-service test`：136 项通过，T22 新增17项。
- `npm --prefix packages/cloud-service run test:pdf`：13 项通过，含四模板真实原字体渲染、超限、多页、71块完整PDF领取及中断恢复；模拟事务/存储不代表真实 CloudBase。
- `git diff --check -- packages/cloud-service .trellis/tasks/10-10-v1-admin-observability`：通过。
- 真实服务路径：成功任务同号重试、查询、重复首块领取只计一个成功/消费/DAU；已知 PDF 渲染失败计一个失败且不消费。
- 文件跨上海午夜：只续传第二块不建新 DAU；真正请求首块后创建一次，重复首块不重复计数。
- 日期：上海日界前/恰好开始/聚合截止/截止之后/次日边界，四来源按同一规则筛选。
- 分页：138 users + 137 activity + 138 jobs + 137 CONSUME = 550 条原始记录，pageSize=17 完整汇总；未完成任务不入终态分母，失败模板不入热度。
- 安全：普通用户、缺可信身份、扫描中禁用/删除管理员均拒绝；坏原始记录和 provider 异常只返回固定错误，不输出正文/标题/标识。
- 覆盖：逐来源起点和 source/day gaps 降级指标到 null；缺口幂等、floor 单调；扫描中 revision 变化返回 STATS_CHANGED。
- 预算：恰好记录预算可以完成，下一条超限明确报错；时间超限没有返回局部指标或成功审计。

原生运营中心、RPC 与 CloudBase 实际权限/分页扫描成本、保留配置及告警尚待对应集成或 T24 验收。模拟不能证明外部平台能力。

## 独立检查后的结果

[backend-check.md](backend-check.md) 记录本次独立检查、实际修复和剩余范围。主会话按 D-049 确认新任务受理事务即计活动后，检查者将活动从 GENERATING 阶段移入受理事务；新增准备跨日/失败/回滚回归，旧请求重试不新记事件。

- `npm --prefix packages/cloud-service test`：**139/139**，T22 共 **20** 项。
- `npm --prefix packages/cloud-service run test:pdf`：**13/13**，修复后重新构建并执行。
- TypeScript 严格编译、两个修改 MJS 的语法检查、范围差异检查通过；包内未配置 lint 命令。
- 改动前明确重现准备失败任务的 FAILED=1、DAU=0；改动后该已受理任务计 DAU=1，准备跨午夜仍只计原受理日，受理事务失败则各事实全部回滚。
