# T14 本地验证证据

日期：2026-10-11。范围为实际 cloud-service 业务模块、T11 运行端口及共享 paper-core；尚未部署 CloudBase PDF 服务。

## 本轮命令

| 命令 | 实际结果 |
|---|---|
| `npm --prefix packages/cloud-service test` | 53/53：admission 25，已有 identity/credits 17、presets 11；包含 cloud-runtime、paper-core 与 service strict TypeScript 构建 |
| `npm --prefix packages/cloud-runtime test` | 26/26；安全 JSON 快照复用 cloneDocument 导出，并拒绝自定义数组原型 |
| 作用域 `git diff --check` + Python 新旧文本尾空白/Markdown 文件引用检查 | 通过；显式包含未跟踪的新实现/测试/证据文件 |
| 业务源码平台导入/console/随机数扫描 | 未发现 Node/微信/文件系统导入、console 日志或 Math.random 调用 |

## 25 项受理行为

1. 完整签名请求号、规范时间编码、UUIDv4、跨用户窗口和查询拒绝。
2. 在首个 await 前复制请求，调用者异步修改不影响参数；拒绝 getters/toJSON/隐藏字段及自定义数组原型，且不执行序列化钩子。
3. 20 路同号只创建/复算/执行一次；异参并发只选一个任务；creator 等待，重试只读 pending。
4. 标题/正文空格、CR/LF、Unicode 原始形式、描红/对齐/缩进、tuple/digest 均纳入指纹；省略值按原可信默认比较。
5. 窗口到期、预设退休、密钥轮换/当前输入限制变小仍按原规则重放；未知 key/version 明确拒绝。
6. 已清理过期号及墓碑不重新消费，刷新窗口不能续旧号；缺执行器禁止新预留但可读已有结果。
7. 未知字段/几何注入/无效选项/超限拒绝；并发和速率计数原子，重试不占新计数。
8. 注入事务提交失败，request/job/credit/reference/rate 全回滚；prepare 异常安全终态并释放。
9. 实际布局摘要和页数在 executor 前复核；准备超时不执行；不确定 executor 不退款、不重排。
10. 提前返回非终态不算已受理；终态后响应丢失可找回结果；日活按用户/上海日去重，查询/重试不计数。
11. 全部 generation 配置及期限关系校验；真实 `createPaperPreparer` 对四模板空白调用共享 core 排版/摘要。
12. 宿主没有 `Object.hasOwn` 和 `String.replaceAll` 时，受理、日活写入、查询与重放仍正常；只复算和执行一次。

测试源：[admission.test.mjs](../../../packages/cloud-service/test/admission.test.mjs)。

## 信任与隐私检查

持久记录只保留安全任务元数据、带密钥指纹、原始校验版本/默认值/限制、请求保护期限、预留和活动事实。布局/文章只在调用内存中；没有存储正文供自动恢复、客户端可覆盖预设、公开 PDF URL 或日志回显。JSON 快照拒绝执行访问器及继承的数组序列化钩子。云端身份沿用可信 provider，跨用户 requestId 不具备授权作用。

独立检查发现并修复两类局部问题，完整根因、文件和验证见 [independent-check](independent-check.md)。两个包均未配置独立 lint 命令；本轮 strict TypeScript 编译及作用域空白/文本检查通过。

## 尚未声称通过的验证

- T14 执行器在行为测试中为合成 fixture；实际 PDF 编码、持久候选路径、成功结算及体积约束由 T15 集成。
- T16 恢复和 T23 删除/墓碑/密钥退役尚待各自任务实现；T14 已提供持久元数据和期限边界，不自动重排。
- 实际共享 preparer 本任务覆盖空白四模板；正式字体/文字与 PDF 全链路随 T15/T24 扩展。
- 内存事务与可控时钟证明本地业务约束，不证明 CloudBase 隔离、断连后调用生命周期、部署资源可用性或生产配置正确。
- 真实字体许可、组件配置、真机及实体打印按 D-044 最后由 Owner 在 T24 完成；本任务本地独立检查已完成。
