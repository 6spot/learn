# T19 应用级兼容与更新设计

> 2026-10-11：按 D-044 自主实施；真实发布更新、服务组件和真机最后验收。

## 边界

现有 App 仅有本地 EditorSession，缺少唯一 CloudClient、兼容缓存和微信更新监听。本任务新增 App 兼容 session、可信预设目录和可复用原生状态提示；扩展 EditorSession 的显式预设替换/清理。复用 root 的 CloudClient、SERVICE_CONFIG 和原字体 loader，不改客户端传输/PDF下载/服务配置/build/backend。

## 单一状态与检查

App.onLaunch 创建唯一 client/editor/compatibility，注册 UpdateManager 一次并启动检查；onShow 合并请求、成功60秒缓存/失败5秒节流，onHide 仅标记不可交互，不把任务视作失败。手动重试仍经同一 session。页面/状态组件只订阅和触发明确操作，不各自检查或阻断历史/隐私/管理员访问。

兼容请求发送编译内核版本和当前锁定组合，无输入正文。校验响应 shape、版本、可信预设和固定字体 pins；云端返回的 ready 不允许未知/不匹配字体进入本地度量。网络/服务不可用、账户删除/停用、资源不可用与代码不支持各有安全状态。CloudClient 不因排版门禁改变历史访问。

## 预设与字体

受控目录由当前发布及锁定响应更新。首次可信同步可替换本地开发占位预设；后续仍 ready 的编辑组合保留，不随 active 更新。已锁定组合退役而当前新组合可用时提示主动刷新，保留标题/正文/设置并清旧 preview/digest，再复算。切模板使用已取得的该模板 current 数据；不增加用户版本选择。回包期间模板切换不覆盖新选择。

本二进制只识别 manifest 固定 font bundle/pins；未知资源明确不可用，不归类为任意 JS 热更新。字体 URL 只来自受信配置或已核对 pins 的兼容描述；本地诊断 local:// 只使用已验证缓存。完整资源保持版本绑定。

## 微信更新

UpdateManager 的检查、下载、ready、失败与业务兼容状态分开。onUpdateReady 仅展示按钮；用户点击“更新并重启”后打开原生确认，有输入时明确提示先自行保留文字、重启不会恢复。只有 ready、明确 confirm、应用仍前台且确认期间输入 revision 未变才 applyUpdate。取消、失败、无更新不循环弹窗，不清输入、不自动重启。

## 应用集成与清理

App 暴露 client、editor、compatibility，T20 接入真实提交前保持生成占位按钮禁用。原生 application-status 组件用于模板/编辑/预览/My 壳，只桥接安全状态；更新、重试、刷新动作调用同一 session。

App.clearUserData():void 同步清标题/正文/描红/设置/cleanup/undo/preview，并使在途预览与兼容回包失效；registerUserDataCleanup(callback) 为后续 T20/T21 请求和PDF缓存加入同一清理点。各owner全部尝试后，若有清理失败抛固定LOCAL_DATA_CLEAR_FAILED，让隐私页保留重试，不吞掉失败。T19不实现完整删除业务、不另建账户/请求/文件singleton。

## 验证

测试合并、缓存/节流、旧组合锁定、首次/主动替换、迟到回包与模板切换、资源/网络/账户错误；仅ready＋confirm才能更新，确认期间输入变化/后台/取消不apply。实际打包 App 注册和组件状态回归；官方模拟器用内存模拟兼容和UpdateManager事件明确标记模拟，保留真实组件/事件与截图。真实发布更新仍待Owner。
