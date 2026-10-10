# T19 独立检查（2026-10-11）

## Findings (fixed)

- File: `miniprogram/lib/compatibility-presets.ts`
  - Issue: JSON边界对普通对象作了原型检查，但数组分支直接复制，接受数组子类/替换原型；对象也接受挂在null-root原型上的继承toJSON。虽然复制未调用钩子，仍违反拒绝异常实例及序列化hook的边界合同。
  - Fix: 数组必须使用其realm的普通Array/Object原型链；对象与数组均通过属性descriptor检查继承toJSON而不读取执行。保留跨realm普通JSON支持和内核严格预设校验。
- File: `miniprogram/test/compatibility.test.mjs`
  - Issue: 只有自有getter/toJSON及普通类对象反例，未覆盖数组子类和继承hook。
  - Fix: 新增1项覆盖5类对象的回归，先复现异常数据被接纳为ready，再验证安全拒绝、不部分安装、hook执行次数为0。同步application-compatibility spec。

## Findings (not fixed)

- 本次T19范围内未留下已复现的代码缺陷。
- T20真实生成和T21记录/额度/文件所有者正在独立集成；本次未改其模块，也未提前补T21的App.records类型。后续集成应继续使用单一App.client及统一清理注册接口，全局类型检查由主会话收敛。
- 正式微信发布、真实UpdateManager下载/应用更新、手机原生确认交互、AppID/CloudBase/字体URL配置与权限仍待最终Owner验收。官方自动化的更新事件/applyUpdate及确认回调明确模拟；实际按钮和警告渲染已验证。

## Verification

- Lint: 未配置独立lint命令；定向`git diff --check`与自动化MJS语法检查通过。
- TypeCheck: pass，T19文件及其传递依赖使用继承根严格配置的`/tmp/learn-t19-check-tsconfig.json`检查；未将并行T21未完成集成描述为全局通过。
- Build: `npm run build`通过；已知上游Fontkit重复axisIndex警告保持原有状态，未扩展依赖修改。
- Tests: 相关Node回归 **46/46**（兼容22、编辑11、运行时13）；官方DevTools兼容 **7组通过，0异常**，基础库3.17.3、模拟微信8.0.5。
- 已核对共享请求/缓存/节流、监听一次、已锁定旧组合保留、主动资源刷新、输入与undo保留、仅ready且明确确认更新、确认期间改文/后台/清理取消、所有清理owner尝试及安全失败。目检真实警告/资源刷新/清理首页截图，恢复原生API与诊断状态后断开IDE连接。
- 未改编辑/字体/Canvas行为，未重复实现期通过的Canvas22项及T18官方9组；本轮未运行真机、真实CloudBase或正式发布。
