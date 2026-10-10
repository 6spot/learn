# T23 后端设计（2026-10-11）

D-051 与 DATA_AND_CREDITS §7.1 已接受短暂禁止重建，生产期限仍显式配置。差距是已有记录只有有效期检查和恢复，尚无完整的对象/元数据清理及删除入口。本任务在 cloud-service 内补齐，不改前端、root 组合或主文档；已有 T22 受理时 DAU 改动保留。

## API 与配置

- `getPrivacyInfo()`：可信身份只读，返回 policyVersion、timeZone、serverTime、retention 和 deletion；不调用自动建账。
- `getDeletionStatus()`：返回 state=none/active/disabled/deleting、requestedAt、earliestReuseAt、serverTime；无 userId 或永久完成凭证。
- `deleteMyData({confirm:true})`：仅当前用户显式确认，事务立即禁止新受理/额度/记录/PDF访问，可重试；无自动提前恢复接口。
- `createLifecycleService({store,storage,clock,crypto},serviceConfig).runSweep()`：可信维护组合，不是用户 RPC。返回无个人标识的记录数、对象删除数、重试、错误、时间、周期和检查点指标。
- `ServiceConfig.lifecycle` 必填字段：pageSize、maxRecordsPerRun、maxRunMs、maxWindowTtlMs、lateIoProtectionMs、deletionProtectionMs、ledgerRetentionMs、activityRetentionMs、auditRetentionMs、inactiveUserRetentionMs。启用时 generation 必须配置，maxWindowTtlMs 至少覆盖当前及历史签名窗口最大寿命。所有期限无生产默认值。

## 删除状态与有限保护

users 保留 deleted 状态直到清理完成，account_deletions 保存 userId/requestedAt/earliestReuseAt 与最小安全处理状态。最早保护截止为删除所在上海月末、已签窗口最大可能到期和显式 deletionProtectionMs 的最大值；扫描已有任务/审计/账本时仅允许延后。该值是下界，不是完成承诺。查询状态不重新建账。

已受理任务继续执行/恢复并原子结算。旧用户的额度账户和 pending 预留必须保留，不能清理出账目缺口。终态后移除不再需要的指纹，留下有限 request tombstone；过期签名号即使 tombstone 后来被清理也不能重新消费。当前月不能获得第二次免费额度；最终个人行、保护身份与删除状态一并清理后才允许正常新建账户。

自然长期无活动用户按显式 inactiveUserRetentionMs 进入同一有限清理路径，不擅自无限保留用户资料。敏感审计保持有限 auditRetentionMs；注册表 publishedBy 的个人关联在账户删除时撤除，保留业务预设本体及无个人身份的历史发布信息。

## 文件与元数据

PDF 到期或用户删除时，事务核对任务/候选/路径/正式引用，先撤销引用；存储 remove 完整 await，未知结果重试，不退款或反转成功。同批在途任务不得清理。候选墓碑至少留至 job.deadline + lateIoProtectionMs，重复清除迟到写入；实际最大执行/存储请求寿命须在 T24 验证，不能以任意开发数值宣称安全。

terminal job 与 history 原子移除，先处理 request tombstone 与已释放 preset_uses。没有真正移除候选前不丢弃唯一清理位置。旧有效 job 在维护扫描时幂等回填 history；孤儿历史索引会清理。消费流水/活动/users/jobs 删除同时调用 T22 source/day coverage gap；自然期限先推进 floor，清除 floor 以下 gap，无永久个人统计事实。

## 分批与并发

维护按固定阶段与稳定ID游标分页，记录数/软时长预算明确，当前 I/O 完整等待。持久检查点 revision CAS 防并发回退，失败可重入。每条在事务复读当前记录与账户，最终删除账户前完整确认无个人依赖/预留；检查点保存失败只导致安全重扫。需要新增写入的 API 在最终事务再次校验账户状态，避免删除后迟到发布/签窗留下个人关联。

## 文件边界与验证

预计 contracts/model/config/service 接口扩展；privacy.ts 负责删除与告知；lifecycle 模块负责有限维护；requests/admission 兼容已擦除指纹墓碑；artifacts/records 复用正式引用保护；presets 在最后写事务校验 active 管理员；credits 明确删除错误。新增独立生命周期测试及真实 PDF 清理测试，README、任务清单和证据同步。

验证含用户隔离/确认、重复删除、删除与受理/上传/领取/结算竞态、下月重新建账、无永久身份、旧请求到期后重试、超过100条分页/预算/游标竞争、存储异常、迟到上传、coverage并发、自然期限、历史回填及脱敏维护报告。真实 CloudBase 定时器、权限、运行上限、告警和手机本地清理留最终 T24。
