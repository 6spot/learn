# T13 可信身份与月度免费额度设计

> 2026-10-10。本轮实现完整本地服务；实际账号配置与 CloudBase 行为按 D-044 留至 T24，生产额度显式配置按 D-045。

## 行为差距和责任

T11 已提供事务/身份/时钟接口，但没有业务账户。新增 `packages/cloud-service` 作为平台无关的实际业务服务；依赖注入 crypto、身份、时钟与 MetadataStore，源代码不导入 Node/微信 API。模拟器和真实云函数复用同一服务。T13 只实现身份、免费额度与供任务层复用的事务内预留/结算原语，不实现纸张生成、支付或广告。

## 公共接口与配置

`CloudService.getAccount()` 每次从可信 provider 获取身份，返回 `{ userId, isAdmin, period, available, reserved, monthlyGrant, periodEndsAt }`。不接受客户端用户号、余额或角色。用户号来自 HMAC-SHA-256(identityKeyId, APPID + OPENID + 固定域)，数据库不保存原始 OPENID；identityKeyId 必须长期稳定，迁移需显式映射迁移。

服务配置必须显式提供 stage、monthlyFreeCredits、quotaTimeZone=Asia/Shanghai、identityKeyId、adminUserIds。本轮不提供生产默认值；测试明确使用 20 次/月。管理员名单仅服务端配置，API 只能返回是否是管理员，后续管理动作仍逐次鉴权。

`CryptoPort` 注入 `hmacSha256(keyId,value)` 与 `randomId()`，业务包不含密钥；运行错误转换为安全机器码，不透传 SDK 及 crypto 的原始异常，不打印身份或输入。

## 数据与事务

- users：userId、创建/活跃时间、active/disabled/deleted 状态，不存昵称头像或正文。
- credit_accounts：当前 period/bucket、available、跨桶 reserved 总数、当期免费额与结束时间，云端独占写。
- credit_buckets：userId+年月的独立免费桶，granted/available/reserved/consumed/expired 守恒；已过期桶不再可用。
- credit_ledger：GRANT/EXPIRE/RESERVE/CONSUME/RELEASE 不可变流水，用确定操作号 create；余额更新与对应流水同事务。
- credit_reservations：任务预留号、用户、原 bucket、pending/consumed/released 状态；T14 将它与任务创建包在同一个事务。

首次登录与本月 GRANT 原子完成；同时 40 次请求只有一个用户和当月赠送。跨月首次访问时原桶的 available 转 expired，reserved 保留，新桶单独 GRANT。旧任务成功只消费旧桶；旧任务失败只返还旧桶，已过期时进入 expired，永不增加新月 available。credit_accounts.reserved 汇总所有未结算预留。

模块内部提供 `ensureAccountInTransaction` / `reserveCreditInTransaction` / `settleCreditInTransaction` 供后续任务编排调用，事务不得包含 crypto、排版、上传等外部副作用；用户身份/HMAC 在事务外完成，时钟在事务回调内重取以覆盖真实 SDK 重试。

## 变更文件

`packages/cloud-service/{package.json,tsconfig.json,src/,test/,README.md}` 和 T13 工件。依赖使用本地 `@learn/cloud-runtime`；后续纸张接口在对应任务引入，根脚本由主会话维护。权威 docs 和 spec 由主会话统一维护。

## 验证

开户与发放并发、事务回滚、同月配置变更不重复发放、Asia/Shanghai 月界/闰年、已有预留时跨月、重复/竞争结算、管理员伪造、停用账户、无身份、不同用户隔离、JSON 中无原始身份和安全错误。

## 后续边界

T14 将任务+预留+流水放入同一事务，T15/T16 控制可信任务终态和 batch/期限；额度原语不能被直接暴露为用户接口。T23 再实现账号删除/保留清理。真实生产免费次数及周期告知由最终配置验收完成。
