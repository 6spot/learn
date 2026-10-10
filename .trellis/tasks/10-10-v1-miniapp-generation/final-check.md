# T20 阶段 B 独立检查（2026-10-11）

检查范围：GenerationSession 安全投影、editor-environment 集成、App 生命周期接线、编辑/预览 TS/WXML、原生生成及兼容/编辑/隐私回归。继承阶段 A [session-check.md](session-check.md) 的安全随机修复，本轮未改云端状态机、纸张内核或 T21 记录页面。

## Findings (fixed)

- 文件：`miniprogram/lib/editor-environment.ts`、`miniprogram/lib/application.ts`、`miniprogram/app.ts`、编辑/预览页面。
  问题：结果导航只检查 `getCurrentPages()` 顶层路由。页面隐藏或 App 进入后台后栈顶仍可能是生成页，晚到可信结果会错误地触发 P06 跳转。新增失败回归证实两种路径均调用了 1 次不应发生的 navigateTo。
  修复：经 root 同意并与 T21 所有者协调，加入应用前台状态和可见生成页 token；自动导航需两者有效且 token 路由与栈顶匹配。App hide 立即失效 token；页面清理只释放自己的 token，防止旧页面取消新页面注册。云端继续、known 状态保留、回前台不补跳。集中清理继续由 generation epoch 阻断晚到回调。
- 文件：`miniprogram/test/generation-native.test.mjs`。
  问题：测试读取共享 `dist/miniprogram`，检查期间源码变化可能未进入该构建，不能证明当前修改。
  修复：使用与原生构建相同的 neutral/es2017/CJS 目标在内存构建当前 App/两个 Page；原字体 provider 保留已构建的专用 miniapp bundle。WXML 从源码读取，不写共享 DevTools 产物。新增 App hide、Page hide 保留路由、旧页面 token、旧 Canvas completion 四项回归。
- 文档：新增前端 [generation-session spec](../../spec/frontend/generation-session.md)，同步索引/质量检查及本任务设计、证据，修正已过期的 generation 清理接线描述。

## Findings (not fixed)

- 无未解决的本轮产品代码问题。既有 fontkit 生成产物 `axisIndex` 重复键警告仍存在；它来自第三方构建代码，本轮没有改写依赖产物或扩大到字体构建。
- 官方模拟器由 baseline 单独负责；本 checker 没有启动 DevTools、执行共享构建或将 VM 的 wx/Canvas/PDF 替身描述为真实微信/CloudBase 验收。组件与云配置、真机、正式更新及实体打印仍按用户要求留最终 Owner 验收。

## Verification

- Lint：仓库没有独立 lint 脚本；本轮 MJS `node --check` 与 `git diff --check` 通过。
- TypeCheck：`./node_modules/.bin/tsc -p tsconfig.json` 通过。
- Tests：当前源码原生生成 **11/11**；生成会话/安全随机/兼容会话/编辑会话 **52/52**；隐私/Canvas **37/37**；统一构建后 emitted editor/compatibility/runtime **19/19**，合计 **119/119**。Canvas 直接运行现有编译产物的测试，未修改 renderer；当前修改的 App/Page/会话从源码构建验证。
- baseline 确认统一 `npm run build` 已包含 T20 前后台/token 守卫及 T21 修复后，本 checker 才运行 emitted 回归。官方 DevTools 仍由 baseline 串行执行，本报告不代替其产品自动化证据。

验证命令及后续模拟器交接见 [evidence.md](evidence.md)。本报告不提交、归档或替 root 标记外部验收完成。
