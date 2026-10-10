# T08 独立复核

日期：2026-10-11。审查 renderer、原生组件/字体加载器/诊断页、构建/自动化脚本及 setup 脚本。保留 T07 核心和 T14 云服务并行修改；未提交或归档。

## 已修复

1. `packages/canvas-renderer/src/index.ts` 原先只检查 `setTransform`/`setLineDash`。使用缺少曲线API的context和实际字体布局可复现：先画白底与48条格线，再抛TypeError。现校验全部15项所需Canvas方法，先返回 `CANVAS_UNSUPPORTED_API`，不改变bitmap和已有画面。测试逐项移除方法，断言无绘制和尺寸不变。
2. `miniprogram/lib/font-loader.ts` 在校验字体后，可选缓存写入同步抛错仍会拒绝整个load。现吞掉该可选缓存错误，保留已验证provider，与writeFile的fail回调语义一致。回归覆盖异步fail及同步throw，验证字体正常返回、下一次加载复用内存且临时文件已清理。

## 审查结论

- 字形只按核心baseline平移一次，font unit按字号/UPEM缩放、y轴翻转一次；不测宽、不重新排版。四模板完整几何、逐线cap/dash/stroke、DPR与zoom独立于毫米坐标。
- 字形实际轮廓墨迹与布局核对，资源和墨迹错误在绘制前拒绝；虚线外接范围采用文档已声明的保守范围。
- layout/provider不上setData，事件仅含计数/尺寸/安全码；组件过期回调、clear、detach均取消待完成绘制并释放bitmap。
- 字体通过固定SHA私有缓存或可信配置加载；同键请求合并，迟到请求不替换较新provider，release清掉持有引用，损坏缓存可重试。
- 构建的字体供应器只有一个vendor文件，原生各entry按输出位置生成相对require。字体构建先生成core/provider声明，随后Canvas及原生typecheck，未依赖旧的声明输出。
- setup发现根目录及5个带manifest的独立包，先检查manifest/lockfile存在再逐个npm ci；`--list`只读。未在共享工作区执行安装，以免影响并行依赖。

未发现其余本任务代码缺陷。T07最终版本组合接入与T09 PDF对照由后续集成收齐；未把这些写成已完成。

## 验证

- `npm --prefix packages/canvas-renderer test`：**15/15**，含严格TypeScript编译。
- `npm run typecheck`：通过。
- `npm run test:runtime`：重建通过，双目标及原生运行时 **13/13**。
- `node scripts/test-canvas-devtools.mjs --diagnostics`：修复后官方模拟器 **11case**通过，翻页/1.5倍缩放/缺资源恢复通过，appExceptions=0。基础库 **3.17.3**、模拟微信 **8.0.5**；退出仅disconnect，保留IDE。
- `node scripts/setup.mjs --list`：根目录与5包；setup/build/自动化脚本 `node --check`、作用域 `git diff --check`通过。
- Lint：无单独配置命令，未声称运行通过。

上游fontkit已有axisIndex重复key构建警告保留，未改依赖。生产字体托管/域名、真实手机内存与性能、字体分发许可、PDF与实体打印依旧留最终Owner验收。
