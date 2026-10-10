# T23 后端验证（2026-10-11）

- `npm --prefix packages/cloud-service test`：166 项全部通过，T23 新增27项；独立检查增加2项先失败后通过的回归。
- `npm --prefix packages/cloud-service run test:pdf`：15 项全部通过，T23 新增2项。
- `git diff --check -- packages/cloud-service .trellis/tasks/10-10-v1-privacy-retention`：通过。
- 独立检查重跑上述服务及真实 PDF 测试全部通过；TypeScript 严格编译随两套命令通过。包未配置独立 lint 命令，新增 MJS 使用 `node --check` 通过。详见 [backend-check.md](backend-check.md)。

所有维护测试使用真实 cloud-service 业务、内存事务/私有存储和可控时钟；显式本地时长不作为生产期限承诺。

## 行为证据

- 隐私与状态查询不创建账户；不接受 false 确认、额外 userId 或非数据属性；同一删除请求幂等。
- 删除后新受理/窗口/账户/记录/PDF立即拒绝，签名、请求查找（含尚未提交的请求号）、文件读取和管理员 mutation 的迟到结果不能绕过最后状态检查。
- 删除中已受理任务可成功并只消费一次；不确定任务由 recovery 达到原 deadline 后失败释放，保护期内 pending 账户/预留不被清除。
- 首轮撤销正式文件能力、擦除不必要指纹；跨月保护和实际清理均满足后返回 none，数据库不再含原 userId；后续正常访问只获得新月份一次 grant，原签名请求仍 REQUEST_EXPIRED。
- 自然文件到期不改变 SUCCEEDED/消费；记录过期时 job/history/preset_uses 同事务删除，request墓碑尚在时 RECORD_EXPIRED，墓碑清理后 REQUEST_EXPIRED。
- 删除一个用户不会删除另一个用户的文件、记录或额度；无关在途任务、有效成功引用受到保护。
- remove 响应未知留下 deleting 可重试；deleted候选在迟到 I/O 窗口内重扫并删除后到上传，窗口结束才GC元数据。重复/并发清扫首次逻辑移除只计一次。
- 127条活动记录跨 pageSize=13/maxRecordsPerRun=17、多实例持久游标完整清理；软时长等待当前I/O完成，CAS并发不能回退，列表/检查点失败安全重试。
- 缺失旧history幂等回填一次，孤儿索引清理；终态清理计数只包含仍存在的 job/history/preset_uses，缺失索引不多计、重试不重复计；长期无活动用户和有限审计分别遵循显式配置。
- 统计source/day缺口无用户标识；最终publishedBy置null且有限审计已清；错误/报告不回显正文、私人标题、文件能力或个人游标。

## 真实 PDF，本地私有存储

- 田字格标题+中文描红：**18,411,605 字节，1 A4页**。
- 拼音40段：**165,148 字节，3 A4页**。
- 两者用真实共享字体度量和PDF编码器生成，独立解析页数；删除立即禁止领取，首轮remove后测试私有存储NOT_FOUND，终态/扣次不反转；有限保护后账户及全部个人关联清理完成。
- 清理阶段没有新增 prepare/render/upload/read PDF 调用；没有原文重排或自动重试。

## 仍需外部验收

这不是 CloudBase 生产部署证据。生产保留数值、历史窗口寿命、迟到执行/存储调用上限、真实定时器/权限/资源成本告警、手机本地输入与文件清理、字体许可和实体打印分别保留至 T24/Owner。
