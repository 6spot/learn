# T13 执行清单

## 启动与设计

- [x] 阅读 PRD、原设计、执行清单、DATA_AND_CREDITS/CLOUDBASE/TESTING、backend runtime spec 与工作区修改。
- [x] 根据已完成 T11 端口细化平台无关服务、身份映射、月度桶和不可变账本设计，主会话批准。
- [x] 按 D-044/D-045 区分本地完整功能与最终真实配置；测试额度显式 20/月，无生产默认。

## 开发交付

- [x] `CloudService.getAccount()` 每次从可信 provider 获取身份，以稳定 HMAC key 映射内部 userId，不存原始 OpenID。
- [x] 管理员只由服务端 internal userId allowlist 决定；配置复制冻结，客户端无法改角色、余额或身份。
- [x] 用户+当月额度+GRANT 流水原子创建，并发只发一次；账户停用/删除拒绝访问。
- [x] 上海时区自然月桶，旧 available 过期，旧 reserved 保留，跳过月份不累积发放。
- [x] 事务内 reserve/settle 原语，旧月释放进入原桶 expired，成功只消费原桶；提供给后续任务编排。
- [x] 所有余额修改和确定操作号的不可变 ledger 同事务，重复/竞争结算不重复消费/释放。
- [x] 未知 SDK/crypto 错误转换为安全码，无输入/身份日志。
- [x] `npm --prefix packages/cloud-service test`：依赖构建+严格 TS 编译+15 项测试通过。
- [x] 文档引用、空白和 source 平台依赖检查。
- [x] 独立检查通过，17 项账户/额度测试；规范已沉淀，按 D-044 完成开发交付。

## 验收映射

| 原验收 | 本地结果 | T24 真实验收 |
|---|---|---|
| T13-AC1 | 每请求可信身份、内部 HMAC ID、服务端 allowlist、跨用户/禁用用户测试 | SDK 上下文和数据库/存储实际权限 |
| T13-AC2 | 并发 40 次仅赠送一次；跨月/旧预留/账本守恒；15 项测试 | CloudBase 事务冲突重试、时钟与生产并发 |
| T13-AC3 | 所有配置必填，生产不使用测试默认；未接支付/广告 | 确定正式免费数值与对应告知 |

详细证据见 [evidence.md](evidence.md)。T14/T15/T16 仍需将这里的原语与任务状态机集成，当前交付不宣称纸张生成已完成。
