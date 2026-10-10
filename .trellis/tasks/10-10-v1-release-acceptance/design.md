# T24 设计边界

> 状态：任务拆解阶段的设计基线。具体库、接口字段或平台参数未在本文件中假定已定稿；执行前按实测补齐。

## 责任与依赖

docs/TESTING.md、发布验收记录与部署操作说明。

前置交付：[T10 完成正式字体与打印验收](../10-10-v1-print-acceptance/prd.md)、[T12 实现可信预设发布与兼容查询](../archive/2026-10/10-10-v1-preset-publishing/prd.md)、[T13 实现身份与免费额度](../archive/2026-10/10-10-v1-identity-credits/prd.md)、[T14 实现请求幂等与任务受理](../archive/2026-10/10-10-v1-job-admission/prd.md)、[T15 实现生成执行与事务结算](../10-10-v1-job-execution/prd.md)、[T16 实现超时对账与恢复](../10-10-v1-job-recovery/prd.md)、[T17 实现记录查询与私有文件领取](../10-10-v1-records-file-access/prd.md)、[T18 实现模板、编辑与预览页面](../10-10-v1-miniapp-editor/prd.md)、[T19 实现应用级兼容与更新流程](../10-10-v1-miniapp-update/prd.md)、[T20 接通生成提交与结果流程](../10-10-v1-miniapp-generation/prd.md)、[T21 实现我的与生成记录页面](../10-10-v1-miniapp-records/prd.md)、[T22 实现最小运营中心](../10-10-v1-admin-observability/prd.md)、[T23 实现隐私、保留与清理机制](../10-10-v1-privacy-retention/prd.md)

## 实现边界

1. 按 TESTING 权威清单组织分层及端到端验收。
2. 复现关键故障窗口并检查账本/任务/文件一致性。
3. 汇总发布证据、回滚步骤与明确剩余项，完成上线前评审。

## 跨层约束

- 纯 TS 排版拥有文字占位、换行、分页；Canvas/PDF 仅绘制；云端编排拥有鉴权、额度和任务结算。
- 物理规格取自 PAPER_PRESETS，文字/字体取自 PAPER_ENGINE，兼容性取自 ARCHITECTURE，任务信任规则取自 DATA_AND_CREDITS；本任务不另建权威副本。
- 平台实际能力、资源版本与生成交付须有证据；Mock、配置草案和预备字体不得标为上线验收通过。

## 兼容、发布与回退

只在责任模块内推进，保留已有行为及基准。涉及排版时发布新的受支持组合，保留在途任务所需旧资源；涉及云端状态时不得以代码回退反转成功/失败终态或直接改写账本。具体部署/回退步骤随选定方案补充后再执行。

## 待验证

任务验收不自动授权生产发布；正式发布动作按当时用户授权执行。

## 依据

- [TESTING](../../../docs/TESTING.md)
- [PRODUCT](../../../docs/PRODUCT.md)
- [CLOUDBASE](../../../docs/CLOUDBASE.md)
- [ARCHITECTURE](../../../docs/ARCHITECTURE.md)
