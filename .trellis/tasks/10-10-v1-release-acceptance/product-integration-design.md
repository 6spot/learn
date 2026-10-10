# T24 原生产品集成自动化设计

2026-10-11：由 baseline 负责 `scripts/test-product-devtools.mjs`、`scripts/test-release-build.mjs` 的八页面/TabBar断言和本页/对应证据；App、页面和runtime库由各原owner实现。T20/T21独立检查修复统一构建后，官方模拟器14组及独立八页面正式包检查已通过，见[本轮证据](product-integration-evidence.md)。这不关闭T24的外部验收。

## 行为缺口与边界

已有模块、单页及兼容测试尚未证明同一个App实例能通过实际八页面完成“可信预览→固定请求→云端生成→记录→完整PDF→隐私清理”。新增测试脚本复用唯一 `installServiceBridge` 和 `createLocalService`，以真实CloudService/真实字体/PDF/内存账本串起现有页面；不复制状态机，不给产品添加测试入口，不修改服务配置/页面/核心，不执行真实CloudBase或发布操作。

报告只在全部约定场景通过后写入，启动先移除旧report。安全输出只含阶段名、计数、布尔、固定错误分类和能力边界。固定合成正文仅用于内存输入及忽略目录截图；完整请求号、正文、布局、凭据和元数据快照不写日志或报告。

## 原生接口

- P01 `/pages/templates/index`，P02 `/pages/editor/index?template=…`，P03 `/pages/preview/index`；编辑/预览生成按钮 `#generate-pdf`。正文/标题输入和描红继续用T18真实原生控件。
- P04 `/pages/me/index` 使用App.records.account，菜单为 `#me-records` / `#me-privacy` / `#me-admin`；生成重试使用 `#generation-retry`，当前revision的Canvas完成后才允许新生成。
- P05 `/pages/records/index`：phase/items/hasMore，`.record-row`；onRefresh/onMore。P06 `/pages/records/detail?jobId=…`：phase/record/canOpen/downloading，`#record-open-pdf`；onRefresh/onRecords。
- P07 `/pages/privacy/index`：phase/localClearFailed/deletion，`#privacy-delete` / `#privacy-status`；onRetryLocalClear。P08 `/pages/admin/index`：status/summary，`#admin-refresh`。
- 统一使用App.client传输。身份仅由诊断Node端选择，切换模拟用户时先清本地App状态；不在页面事件中增加userId。

## 场景

1. 管理员零任务统计“暂无”；普通用户“我的”无管理员入口，直接进运营页仍由真实云端拒绝；新用户空记录。
2. 四模板×空白/填字/描红共12条真实预览/生成，检查云端成功、页数/锁定组合、私有PDF完整散列和扣次。拼音用固定合法拼音；每个版式原文保留，超长内容明确拒绝且不新增消费。
3. 连续点击合并；分别注入受理前网络丢失、成功后响应丢失及查询失败。重试使用同一requestId和快照，真实服务只消费一次；故障注入只在传输交接处，不伪造成功任务。
4. 真实prepare调用暂停时离开编辑页，记录显示处理中；释放调用后同一云端任务完成，页面留在当前记录位置并可重新打开结果。另显式调用实际App/Page的onHide/onShow模拟后台，已结算的迟到响应不能抢占导航，回前台后可从记录查询；不将手动生命周期调用写成真机后台验证。未知结果不当作失败。
5. 使用真实服务的小扫描预算和受控过期/删除标记生成空/短页及签名cursor；列表继续加载，查询失败保留之前安全记录，恢复后可刷新。分页显式调用实际页面onMore并等待可见行数/终点，避免自动化scroll-to-tap触发onReachBottom导致按钮提前消失。详情查询失败禁用旧领取按钮；过期不自动重做。
6. 完整原生FS落盘，从原生文件分块读回由Node计算SHA，与真实服务PDF一致。首先探测实际openDocument；若模拟器不支持，仅viewer返回值模拟且报告注明，文件写入/长度/散列仍为实际路径。打开/重复领取不再次扣次。
7. 普通用户无法读取别人的任务/PDF；管理员按实际日期/覆盖期返回数字或“不可用”，不把null计0。
8. 隐私原生按钮取消不删除；明确确认清除输入/预览/请求/PDF，云端停止新生成及文件访问。注册清理owner失败模拟保留重试；释放迟到提交/PDF/查询回包不能恢复草稿、导航或打开文件，重试后本机目录无残留。服务任务终态/账本仍一致，隐私页不自行创建账户。

T19已完成的7组兼容测试引用其证据，不在本脚本重复全部更新状态。T18键盘/缩放细节继续引用本轮编辑回归；本脚本保留主要真实页面交互。

独立正式包检查要求恰好八个产品页面、首页为纸张页、TabBar仅纸张/我的且图标在包内；同时保留原有诊断/密钥/字体/PDF/源映射排除与2 MiB主包上限。不修改源app.json或现有开发产物。

## 模拟与验收界限

内存身份/存储、网络丢失/暂停/清理失败均是明确故障注入；真实服务规则、两端共享布局、PDF字节与原生组件不替换。SDK Native.cancelModal在T19当前模拟器不回调，因此隐私确认可以只调用实际showModal注册的success回调，并单独展示原生警告；不得写成真机取消/确认通过。所有临时wx覆盖和合成输入在最后恢复/清理，导航关闭modal，disconnect而不关闭用户IDE。

最终Owner仍需真实CloudBase可靠执行/事务/权限/文件、正式发布更新、真机查看/保存/分享、字体许可、实际打印、平台资质及服务组件配置。T24整项保持开放。
