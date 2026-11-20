# 版本记录

## v0.4.0-workers

- 隔离 WebSocket lane 的普通建连失败、握手超时和上游断开。Bridge 清理失败流并通知客户端，健康 lane 可以继续通信。
- 增加 30 秒首次启动截止，收紧父授权到期、撤销和续签签名期间的边界处理。并发关闭只发一次全局通知。
- 清理失败 lane 的回调和定时器，处理尚未使用的 AES-CTR 预导入失败。管理台机房和 RTT 来自当前请求的 Cloudflare 元数据。
- 发布任务验证标签对应的提交已进入 `main`，核对独立 JS、源码 ZIP 与 SHA-256。 [验收记录](./docs/stability.md)

## v0.3.0-workers

- 所有新代理连接和管理操作要求有效的 `p`。提前回收等待信用通知的上传缓冲，给停滞的原生队列检查增加退避。 [验收记录](./docs/cfnew-study.md) · [Release](https://github.com/bababoyi6/b/releases/tag/v0.3.0-workers)

## v0.2.0-workers

- 提供独立 Workers Module 和可复现源码 ZIP。按父会话到期发出单次关闭通知，减少下行等待期间的缓冲保留。 [Release](https://github.com/bababoyi6/b/releases/tag/v0.2.0-workers)
