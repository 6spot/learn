# T21 独立检查（2026-10-11）

## Findings (fixed)

- File: `miniprogram/lib/record-sessions.ts`
  - Issue: 详情原先查到有效成功记录后，领取PDF若返回NOT_FOUND/RECORD_EXPIRED，仍保留ready及打开按钮。账户撤权触发集中清理后，下载错误也未把idle改为明确error。
  - Fix: 不可访问记录及账户撤权均进入安全错误态并清除本地record/领取资格；单记录失效不触发全账户撤权。保持云端终态和额度不变。
- File: `miniprogram/test/records.test.mjs`
  - Issue: 缺少领取阶段失效及集中清理与在途原生写入/元数据请求组合的回归。
  - Fix: 新增2项。6类错误码回归先失败后通过；实际下载器晚写入/三类迟到查询均不能恢复清理前状态，写入完成后文件被删除、未打开阅读器，严格清理可重试成功。

## Findings (not fixed)

- T21责任范围内未留下已复现的代码缺陷。已核对安全数据投影、分页空短页/游标预算、5项轮转轮询、前后台失效、启动单下载器、全部所有者清理、唯一路由及T22/T23入口集成。
- T20审查随后发现后台保留editor route可能导致迟到导航，root已授权stats_check负责App前后台及可见页面守卫。T21未修改App/application或生成/编辑/预览模块；此跨任务修复由T20复核，最终合并检查由root汇总。
- baseline负责构建和官方模拟器；本次未调用DevTools。真实CloudBase、手机PDF阅读器/文件系统/反馈及实体打印仍为最终Owner验收。

## Verification

- Lint: 未配置独立lint；测试MJS语法和定向`git diff --check`通过。
- TypeCheck: `./node_modules/.bin/tsc -p tsconfig.json`完整通过，针对本次T21修复后的合并源码；不覆盖之后另行接入的T20导航守卫。
- Tests: records **19/19**、privacy **15/15**、admin **12/12**，合计 **46/46**。
- 单元/VM原生页面与实际下载器结合使用模拟文件系统、阅读器和可控异步响应；不声称真机或生产授权验证。日志 `/tmp/learn-t21-check.log`、`/tmp/learn-t21-typecheck.log`。
