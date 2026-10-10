# T13 身份与额度验证证据

实现日期：2026-10-10；独立复核：2026-10-11。代码位于 `packages/cloud-service`；本地测试采用真实业务服务加 T11 内存适配，没有另写模拟账户服务。

## 本次验证

- `npm install --prefix packages/cloud-service`：成功，审计 0 漏洞。
- `npm run test:service`：cloud-runtime/paper-core/service 严格 TypeScript 编译通过，28 项 Node 测试全通过，其中 T13 17 项、T12 11 项。
- 无单独配置的 lint 命令；本次通过严格编译、作用域内 `git diff --check` 与源码导入/日志扫描。
- 所有源码无 `node:`/微信 API/文件系统导入；无日志语句和嵌入生产密钥。
- 本任务 Markdown 链接及新增源码/测试空白检查通过。

## 行为证据

1. 40 次并发首次调用只创建一个用户、一个当月免费桶、一次 GRANT；对外仅返回账户允许字段。
2. 每次读取可信身份；伪造 userId/role/available 不影响结果；不同 APPID/OPENID 映射不同用户。
3. 管理员只由服务端内部用户号 allowlist 决定；外部修改原配置数组不会改变已构造服务。
4. 缺失额度、非法值/时区/身份 key 配置拒绝启动；生产无隐式默认，允许显式 0 次。
5. 提交失败整体回滚，无半个用户/余额/流水；账户 disabled/deleted 不再发放。
6. 上海时区月界覆盖闰年和年切换；跨 4 个月只发访问到的两个月，不追补未访问月份。
7. 同月配置额度变更不加发；次月采用新配置。
8. 20 个请求争抢 1 次额度只有一个成功预留；同预留重复执行幂等，消费/释放竞争只有一个终态与一次流水。
9. 新月份已发放并发生新预留时，旧月释放仅增加旧桶 expired，不增加新月 available；旧月成功仅消费旧桶。
10. 跨用户预留号碰撞和结算被拒绝；同月失败返回一次可用额度。
11. 每个桶的 ledger delta 与 available/reserved/consumed/expired 完全一致，四者之和等于该桶 granted。
12. 原始 OpenID 不出现在元数据；crypto/provider 原始错误包含合成敏感信息时，对外只有安全机器码。
13. 非法结算 outcome（如误传任务状态 `failed`）返回 INVALID_ARGUMENT，任何账户、预留和流水数据均不改变；之后正确消费仍满足账本守恒。
14. 跨月释放先于新月首次账户读取时，旧预留正确转入旧桶 expired，新月免费额度只在账户读取时发放一次。

## 独立复核修复

结算原语原先仅依赖 TypeScript 联合类型约束 outcome；运行时误传 `failed` 会减少 reserved，却既不消费也不归还额度，并写入非法预留终态。已在 `settleCreditInTransaction` 写入前校验只允许 `consumed`/`released`，并新增非法入参不写入和跨月释放顺序的回归测试。详细结论见 [T12/T13 独立复核](../10-10-v1-preset-publishing/independent-check.md)。

## 交接与局限

T13 对外接口为 `CloudService.getAccount()` 与 `AccountResponse`；事务原语留在内部 credits 模块，T14～T16 将其与正式任务/执行批次/期限校验组合。测试不是 CloudBase 真实并发证明，生产账号/权限、SDK 时钟和事务行为、实际免费配置/告知留至 T24。测试额度 20/月仅为开发夹具，业务包不包含默认额度或测试密钥。
