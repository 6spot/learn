# T20 原生安全随机来源

2026-10-11，root 核对官方正文：[wx.getRandomValues](https://developers.weixin.qq.com/miniprogram/dev/api/device/crypto/wx.getRandomValues.html)。通过 HTTPS 取得 200 正文；网页搜索工具未能打开该站，实际正文使用命令行获取并解析。

- 正确文档路径是 `api/device/crypto/wx.getRandomValues.html`。`api/base/crypto/wx.getRandomValues.html` 返回 404，不作为能力缺失证据。
- 官方说明基础库 2.15.0 起支持，入参 `{length,success,fail}`；成功返回 `randomValues: ArrayBuffer`，长度等于请求的字节数。当前官方模拟基线为 3.17.3，实际 API 调用仍由 T20 自动化验证。
- T20 请求 16 字节，设置 UUID v4 的 version/variant 位，按标准小写十六进制格式输出，并调用既有 `createRequestId` 协议。随机结果长度/类型不符或 API 不可用时明确失败，禁止回退 `Math.random`、时间戳或设备标识。
- `UserCryptoManager.getRandomValues` 是另一 API，官方路径在 `base/crypto`；本任务无需为取随机数引入用户加密密钥管理。
- 随机值/完整请求号不写日志。重试使用已有完整请求号与参数快照，不重新签发窗口或取随机数。

这次核对仅确认接口文档，不是 iOS/Android 真机证据，也不代替云端签名、身份和幂等校验。
