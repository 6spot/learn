# T19 本地交付与模拟证据

2026-10-11：实现与独立检查完成，提交/归档由主会话负责。真实配置、正式发布更新和真机按 D-044 留最终 Owner 验收。

## 实现

- App 唯一 client/editor/compatibility；冷启动/回前台合并检查，成功60秒缓存、失败5秒节流，UpdateManager仅注册一次。
- 兼容JSON在边界复制数据descriptor，支持原生对象环境差异，拒绝getter/toJSON/异常实例；保留内核严格plain-object/版本/预设校验。整个响应验证后才安装，固定font bundle及每个资源的SHA/字节数/版本均需匹配。
- 首次可信同步替换未验证种子；已验证且仍ready的旧组合不随active改变。退役组合由用户主动刷新，原始输入、设置、整理与撤销保留，preview/digest失效后重算。
- 原生application-status用于模板/编辑/预览/我的；网络/服务/账户/资源/代码状态分开。代码不兼容时不显示误导性的资源刷新入口。历史RPC仍直达同一client且由云端鉴权。
- 更新ready只显示按钮，不自动弹窗。仅用户主动确认、仍ready/前台、revision与清理epoch未变才applyUpdate，且本session最多一次。取消、后台、输入改动、清理均使确认失效。
- clearUserData清输入/选项/cleanup/undo/preview与在途兼容/预览；注册接口留给T20/T21。全部owner尝试后若任一失败，抛固定LOCAL_DATA_CLEAR_FAILED，供隐私页重试，不泄漏原始异常。T20真实提交尚未接入前，generation.available保持false。

## 实现期验证

| 检查 | 结果 |
|---|---|
| `./node_modules/.bin/tsc -p tsconfig.json` | 通过 |
| `npm run build` | 通过；已知vendor Fontkit重复axisIndex告警未在本任务修改 |
| `node --test miniprogram/test/compatibility*.test.mjs` | 21项通过（19状态/资源/竞态＋2真实构建App/组件） |
| `node --test miniprogram/test/editor*.test.mjs` | 11项通过 |
| `node --test packages/runtime-smoke/test/runtime.test.mjs` | 13项通过 |
| `npm run test:canvas` | 22项通过 |
| `node scripts/test-editor-devtools.mjs --diagnostics` | 官方模拟器9组通过，零应用异常 |
| `node scripts/test-compatibility-devtools.mjs --diagnostics` | 官方模拟器7组通过，零应用异常 |
| `git diff --check` | 通过 |

兼容回归包括：并发Promise/缓存/节流、初次可信同步及原文/undo、旧组合锁定、退役主动刷新及重复点击合并、切模板竞态、缺失/错误pins、错误响应不部分安装、跨realm JSON和不执行访问器/序列化hook、不可变tuple、错误分流、历史可访问、清理迟到回包与预览、监听一次、仅ready+confirm重启、取消/前后台/改文/删除取消确认、挂起确认清理、清理owner失败聚合。

## 独立检查复核

- 修复 JSON 归一化接受数组子类/替换原型及继承 `toJSON` 的合同缺口。新增1项含5类异常对象的回归，先复现 ready（应拒绝），修复后均安全拒绝且钩子执行次数为0；原跨realm JSON及实际微信桥接保持通过。
- T19 文件及传递依赖严格类型检查通过：`tsc -p /tmp/learn-t19-check-tsconfig.json`；该配置继承根 tsconfig，仅列入本任务 App/session/component/editor/preview/templates 文件。T21 正在补 App.records 集成，按分工不提前修改其新模块或全局类型。
- `npm run build` 通过。`node --test miniprogram/test/compatibility*.test.mjs miniprogram/test/editor*.test.mjs packages/runtime-smoke/test/runtime.test.mjs` **46/46**（兼容22、编辑11、运行时13）通过。未重复未改动的 Canvas 或 T18 全量官方测试。
- 重新运行 `node scripts/test-compatibility-devtools.mjs --diagnostics`：**7组通过，0应用异常**。已目检新生成的真实更新警告、资源刷新、清理后首页截图；确认重启失去输入提示和诊断清理正常。依然只对确认回调/更新事件作明确模拟，不将其称为真实发布更新验收。
- MJS语法和定向 `git diff --check` 通过。日志 `/tmp/learn-t19-check-build.log`、`/tmp/learn-t19-check-final.log`、`/tmp/learn-t19-check-devtools.log`；详见 [check.md](check.md)。

## 官方模拟范围

基础库3.17.3，模拟微信8.0.5，平台devtools。复用 `scripts/diagnostics/automator-bridge.mjs` 及真实本地CloudService的内存身份/存储；生产源配置不改，未连接真实CloudBase或发布active预设。

最终报告与截图在忽略目录：

- `dist/compatibility-evidence/report.json`：7组及模拟边界。
- `network-error-preserves-input.png`、`resource-refresh-required.png`、`code-update-failed.png`：已目检状态分流/原文保留。
- `native-update-input-warning.png`：用实际session产生的选项经未改写的wx.showModal真实渲染，已目检重启不保留及先复制提示。
- `cleanup-home.png`：恢复wx API、清理合成输入及诊断状态、导航清除modal后的首页，已目检无残余弹窗。
- `dist/editor-evidence/report.json`：本轮T18编辑回归9组。

UpdateManager事件/applyUpdate计数及确认/取消返回值是模拟。点击使用实际原生按钮，确认结果只调用实际注册的success回调；不得写成正式更新或原生确认操作已验收。官方SDK `Native.cancelModal` 在本环境（含默认按钮独立probe）未触发回调，失败尝试未产生通过报告；最终明确模拟确认结果，并独立保留真实弹窗显示证据。测试最后恢复getUpdateManager/showModal和源App composition，清理合成内容，导航回首页以关闭modal，不关闭用户IDE。

初版自动化遇到原生JSON对象边界差异（同响应在Node可通过、桥接后严格校验拒绝）；边界descriptor复制后通过。单个prototype比较不足以断言唯一根因，因此另有独立VM跨realm/访问器回归，未放宽内核规则。同步带函数的UpdateManager对象无法通过mockWxMethod序列化完整模拟，改为仅测试进程的运行时覆盖并恢复。

## 留待最终验收

真实AppID/CloudBase/固定字体URL配置与权限；微信正式代码发布、真实下载ready/failed/无更新及applyUpdate重启；真机原生modal取消/确认、切后台、键盘/安全区/内存；字体许可和实体打印。模拟不替代这些项目。T20/T21需继续使用App唯一client和注册清理接口，尤其在清理时取消旧提交导航/历史查询/PDF回包；已受理云任务仍独立结算。
