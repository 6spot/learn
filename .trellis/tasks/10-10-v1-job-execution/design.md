# T15 设计边界

> 状态：任务拆解阶段的设计基线。具体库、接口字段或平台参数未在本文件中假定已定稿；执行前按实测补齐。

## 责任与依赖

云端生成执行、上传、任务终态与账本结算。

前置交付：[T09 实现 PDF 渲染](../10-10-v1-pdf-renderer/prd.md)、[T11 CloudBase 环境与可靠执行验证](../archive/2026-10/10-10-v1-cloudbase-feasibility/prd.md)、[T14 实现请求幂等与任务受理](../archive/2026-10/10-10-v1-job-admission/prd.md)

## 实现边界

1. 接入同版复算、PDF、候选产物与执行批次。
2. 实现受理交接和成功/失败事务条件。
3. 故障注入验证竞争结算、上传后事务失败、响应丢失和无效批次。

## 跨层约束

- 纯 TS 排版拥有文字占位、换行、分页；Canvas/PDF 仅绘制；云端编排拥有鉴权、额度和任务结算。
- 物理规格取自 PAPER_PRESETS，文字/字体取自 PAPER_ENGINE，兼容性取自 ARCHITECTURE，任务信任规则取自 DATA_AND_CREDITS；本任务不另建权威副本。
- 平台实际能力、资源版本与生成交付须有证据；Mock、配置草案和预备字体不得标为上线验收通过。

## 兼容、发布与回退

只在责任模块内推进，保留已有行为及基准。涉及排版时发布新的受支持组合，保留在途任务所需旧资源；涉及云端状态时不得以代码回退反转成功/失败终态或直接改写账本。具体部署/回退步骤随选定方案补充后再执行。

## 待验证

资源限制以实际 PDF 和 CloudBase 实测校准，不直接把核心默认 maxPages 当作产品上限。

## 依据

- [DATA_AND_CREDITS](../../../docs/DATA_AND_CREDITS.md)
- [ARCHITECTURE](../../../docs/ARCHITECTURE.md)
- [CLOUDBASE](../../../docs/CLOUDBASE.md)
- [TESTING](../../../docs/TESTING.md)
