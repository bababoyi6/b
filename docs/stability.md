# v0.4.0 Workers 稳定性和发布验收

## 基线与范围

基线为 `b5835145b157f22691b671470856d0d37f07316e`。GitHub 的 v0.3.0-workers 标签、发布任务和源码对应同一提交，回下载的独立 JS、ZIP 和校验表与重构建字节一致。远端 `main` 起点 `9bae146` 是 `59aeb06` → `9158d63` → `432737c` → `b583514` 的祖先。原 PR #1 的目标是 `codex/workers-release-hardening`，本轮将完整历史通过独立 PR 纳入 `main`。 [v0.3.0 基线](https://github.com/bababoyi6/b/commit/b5835145b157f22691b671470856d0d37f07316e) · [原 PR](https://github.com/bababoyi6/b/pull/1)

审计范围包括 Bridge 的 HELLO、续签、`openLane`、`finish`、`fail`、`shutdown`，Worker 的票据与登录、防重放与 admission、`Lane`、上下行泵、`Queue`、`PacketAssembly`、原生发送、KWS 竞速与取消、密码派生缓存、诊断和发布构建。

## 故障范围与修复

| 情况 | 行为 |
| --- | --- |
| 普通网络关闭、新 WebSocket 构造失败、8 秒握手超时 | 清理该 lane，通知一次 `CLOSE`。其他 lane 可继续传输。Bridge 保留已使用的 ID 记录，由客户端分配新 ID。 |
| 已建 lane 的 KWS 断开、队列资源超限 | 终止该 lane，释放队列与等待，关闭本流的上下游。未确认传输的数据留给客户端协议处理。 |
| 从 HELLO 起始终未出现有效 Upgrade | 首批 lane 全部失败可提前关闭。30 秒独立截止也涵盖 WELCOME 后一直没有 OPEN 的情况。 |
| 续签网络故障或容量拒绝 | 并发 lane 共用一次续签任务。原有最多四次、按请求截止时间退避的预算继续生效。耗尽后只结束等待续签的 lane。 |
| 续签认证拒绝、响应票据格式错误、父授权到期或本地撤销 | 取消续签，通知端侧一次父会话关闭，清理全部本 Bridge 的 lane。Worker 对到期或撤销用 `4001` 保留父会话原因。 |
| 协商子协议错误、严重载体帧错误或明确的 WebSocket `1008` | 父 Bridge 失败并退出。普通浏览器握手错误通常不提供 HTTP 状态，能确认的续签认证拒绝独立处理。 |

修复前可复现的缺陷包括新 lane 的普通错误误触发全局关闭、已有 WELCOME 时缺少独立启动定时器、到期与 Worker 票据签名之间的竞态、待用 AES-CTR 密钥导入失败引发未处理拒绝，以及将请求的 `cf-placement` 当作 Worker 放置展示。修复后，关闭先标记并摘除回调，再清理定时器、队列和 socket。Worker 在异步验签、签发返回及流 I/O 处复核有效期。父会话关闭码前不再发送会遮蔽原因的 lane CLOSE 帧。诊断只展示 Cloudflare `request.cf` 提供的本次请求入口与 RTT，并将缓冲值标为应用记账。 [Telegram 载体协议](https://github.com/telegramdesktop/tproxy-server/blob/master/PROTOCOL.md#carrier-modes) · [Cloudflare Request 元数据](https://developers.cloudflare.com/workers/runtime-apis/request/#incomingrequestcfproperties)

本实现沿用参考协议的帧和端侧 `CLOSE` 语义，定向收窄了参考实现对新 WebSocket 建连失败的全局处理。父会话关闭后由 Telegram 客户端决定何时重新初始化。应用实例不会跨请求保存 WebSocket 对象。`DELETE` 使本 isolate 拒绝新连接或续签，已有 Worker lane 在自己的下一次 I/O 或绝对到期时退出。Bridge 发起退出时会直接关闭自己的所有 WebSocket。无共享存储时，限流、撤销记录与计数的范围是当前 isolate。

## 自动化生命周期与安全

模拟时钟覆盖父授权到期前一秒、到期瞬间与后一秒，验证了签名结束时已到期的续签不会获得票据。还覆盖多个 lane 共用续签、续签响应迟到、同一个到期事件与普通断开交错、重复 CLOSE、晚到 `onopen`、关闭页面清理、旧票据拒绝、新 Bridge 创建，以及重新加载 Worker 模块后的无状态票据验证。Workerd 通过模拟的短期票据验证真实 WebSocket 收到 `4001`。

保持 `p` 16 字符的最小值，测试了 15、16、17 字符及管理 Cookie 到期。PBKDF2、HKDF、HMAC、Cookie 作用域、Origin、`tg://webproxy` 格式和 host 绑定沿用已有向量与回归。应用日志没有输出 Secret 或 Token。平台配置的请求 URL 日志可能包含 Bridge capability，默认关闭应用日志。无授权流程不会连接 KWS，正式拨号只使用按 DC 编译产生的 Telegram 官方 HTTPS 主机。

慢客户端、分片和大包、信用耗尽与恢复、阻塞上游、两个 KWS 失败或迟到成功、备用并发上限和冷却均有自动化验证。应用预算为 `32 MiB/lane`、`36 MiB/父会话` 和 `40 MiB/isolate`，与 Cloudflare 的 `128 MB` 实例上限所涵盖的总内存不同。受控故障中可见的队列、原生计数和定时器都完成清理。运行时队列、WebCrypto 内部缓冲、GC 和系统调度的真实边缘峰值仍可能高于应用计数。 [Cloudflare 上限](https://developers.cloudflare.com/workers/platform/limits/)

**代码级自动化验收通过；真实 Telegram 客户端长时间恢复行为尚待用户后续观察。** 未把模拟到期当作真实设备连续 12 小时、休眠唤醒或切换网络的验证。

## 有界性能对照

Windows Node 24.16，本机模拟七轮交替运行。吞吐为各轮中位数，延迟为各轮批次 P95 的中位数。闸门另使用独立 AES-CTR 及明文 SHA-256，逐一校验下载、上传、慢消费者和 KWS 帧边界。模拟速度用于比较实现开销。

| 场景 | 吞吐 MiB/s，v0.3.0 → v0.4.0 | P95 ms，v0.3.0 → v0.4.0 | 应用记账峰值 MiB，v0.3.0 → v0.4.0 |
| --- | ---: | ---: | ---: |
| 交互小包 | 1.497 → 1.461 | 0.109 → 0.116 | 0.001 → 0.001 |
| 并发交互与媒体 | 375.0 → 363.9 | 1.852 → 1.949 | 3.175 → 3.271 |
| 128 KiB 分块持续下载 | 749.7 → 748.8 | 2.239 → 2.150 | 1.502 → 1.502 |
| 512 KiB 分块持续上传 | 1506.4 → 1513.6 | 2.095 → 1.984 | 4.001 → 4.001 |
| 1 MiB 分块下载 | 1210.1 → 1194.5 | 2.314 → 2.352 | 4.001 → 4.001 |
| 慢客户端下载 | 7.947 → 7.937 | 125.490 → 125.705 | 3.378 → 3.378 |

两版持续下载的范围为 `709.8–761.4` 与 `587.4–774.3 MiB/s`，上传为 `1426.8–1516.9` 与 `1462.9–1561.1 MiB/s`。小包、混合和持续传输场景的 Native WebSocket 发送数相同，避免把一次波动解释成提速。Windows CPU 采样主要落在 0 或 15–16 ms 的倍数，真实边缘 CPU 和分配归属仍需独立测量。 [传输基准](../benchmarks/transport.mjs)

第二轮七次复测的交互小包 P95 为 `0.121 → 0.128 ms`，两轮均增加约 7 微秒。混合吞吐从 `317.4 → 331.8 MiB/s`，与首轮相反。持续下载复测为 `891.9 → 902.4 MiB/s`，上传复测为 `1730.2 → 1724.3 MiB/s`。样本范围重叠，未发现可重复的明显吞吐回退。

eooce 的提交 `bf090ad` 提供的可借鉴点是有限包大小与收集等待分开的设计。只在本地参数实验中将 Worker 上行合批限制为 20 KiB，交互 P50/P95 从 `0.073/0.107` 变为 `0.075/0.119 ms`，混合下发从 432 次变成 496 次。另一组对不足 32 KiB 的首批增加 1 ms 等候，Windows 实际计时粒度使交互 P95 从 `0.114` 升到 `16.047 ms`，下发次数仍为 440。大块下载未显示可重复改善。cfnew 的有界队列、取消和可复现发布思路已有对应实现。本轮保留现有合批与 AES 参数。 [eooce 参考源码](https://github.com/eooce/Cloudflare-proxy/blob/bf090adabc54c8d55a3de4d5a3f5d2509fd7108f/_worker.js#L26) · [cfnew 对照](./cfnew-study.md)

Cloudflare 支持出站 WebSocket 构造器，也支持 `fetch` Upgrade。现有 `fetch` 路径可明确校验状态和子协议、禁止重定向并用信号取消握手，已通过官方 KWS 实测。替换构造器的失败、取消与 P95 收益缺少证据，正式路径沿用 `fetch`、3 秒单拨号上限与 900 ms 备用延迟。 [Cloudflare WebSockets](https://developers.cloudflare.com/workers/runtime-apis/websockets/)

本机首连每版每场景 40 次，全部成功。从启动 Bridge 请求开始计时，KWS 网络由测试桩模拟。成功首连保持一次拨号，主 KWS 立即失败时保持两次拨号。

| 本机首连阶段 | v0.3.0 P50 / P95 ms | v0.4.0 P50 / P95 ms |
| --- | ---: | ---: |
| 冷 Bridge 页面 | 3.258 / 3.681 | 3.318 / 3.702 |
| 冷首连到 KWS 已连接 | 5.812 / 6.481 | 6.012 / 6.700 |
| 冷首批转发 | 6.672 / 7.632 | 6.951 / 7.920 |
| 热首批转发 | 2.146 / 2.893 | 2.383 / 2.672 |
| 主 KWS 失败后首批转发 | 6.595 / 7.062 | 7.068 / 7.354 |

正式候选通过 77 个 Node 测试、8 个 workerd 测试和含 13 种负载的明文完整性基准。完整性基准分别对照基线与候选的 KWS 和实验 TCP。 [首连基准](../benchmarks/startup.mjs) · [发布检查](../.github/workflows/workers-release.yml)

## 隔离 Worker 握手

对照使用两条已有的隔离 Cloudflare Worker，均只注入合成 `p`。测试验证 `/admin` 派生的链接、Bridge、WebSocket Upgrade、DC 1–5 普通和媒体 KWS 返回的 `resPQ` 以及 nonce。P50/P95 从开始发出 Bridge 请求累积，以成功样本当中的最近秩分位数表示。没有使用真实 Telegram 账号。

预发布构建的配对测试中，基线 `30/30`，候选 `29/30`。候选一次普通 DC 1 的 Bridge 请求失败。端到端 `resPQ` 的基线 P50/P95 为 `4.148/5.815 s`，候选为 `4.062/7.224 s`。Bridge 页面 P95 为 `4.658 → 5.464 s`，本轮在 WebSocket 开始前已经出现秒级差异。该轮候选包含连接隔离修复，最终签名后到期复检另对实际发行字节进行在线确认。

最终独立 JS 的 SHA-256 是 `9ee5dff18a1ac94ccbb7ac185028c44a68dc41a1c063bae291f5113747080f11`。从该文件原样部署后进行十组配对，每版 `10/10`，覆盖普通及媒体 DC 1–5。Bridge 页面 P50/P95 为 `2.310/6.808 → 2.419/5.019 s`，端到端 `resPQ` 为 `4.706/9.964 → 3.806/6.745 s`。在线首轮与此轮 P95 方向相反。这十组的 P95 是最大值，因此只用于复核发行版的握手可用性。 [在线探测脚本](../experiments/probe-pages.mjs)

## 发布、回滚与待观察项

从 `main` 上经过普通 PR 合并的提交创建 Workers 版本标签。发布任务核对 `main` 祖先关系、版本号、Node 和 workerd 测试、固定基线、源码与包字节以及 SHA-256。正式交付为 `telegram_webproxy.js`、源码归档 `Workers.zip` 和 `SHA256SUMS.txt`。Dashboard 通过编辑器发布独立 JS。保持域名和 `p` 即可使用原链接。故障回退使用 Cloudflare 部署历史中上一版本。 [发布页](https://github.com/bababoyi6/b/releases/tag/v0.4.0-workers) · [Workers 静态资产](https://developers.cloudflare.com/workers/static-assets/) · [可执行模块上传 API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/) · [版本回滚](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)

单 Worker 与 `p` 即可用于日常部署。真实客户端持续运行、设备休眠恢复、网络切换和自然故障后的恢复节奏留待日常使用观察。应用测试无法覆盖各运营商路由或边缘平台原生内存峰值。
