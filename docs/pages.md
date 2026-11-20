# Pages 交付与上游验证

## 交付基线

从远端 `codex/worker-relay-optimization` 的 `59aeb06b19ed24b90555ce3d88de668410e0ebb5` 开始。开始时远端 `main` 为 `9bae146`，两个分支均重新核对。正式 `Pages.zip` 由公开源码生成，根目录的唯一文件是 Advanced Mode Module Worker `_worker.js`。固定 ZIP 时间戳、UTF-8 编码和存储方式，构建时拒绝填入随机种子的私有 JS。验证器核对目录、CRC32、SHA-256 与源码。真实 workerd 直接加载从 ZIP 解出的文件。 [打包](../scripts/build-pages.mjs) · [验证](../scripts/verify-pages.mjs) · [发布工作流](../.github/workflows/pages-release.yml)

Pages 上线只需生产 Secret `p`。真实验证项目的 `/admin` 在首次部署、保存 `p` 后分别返回 404，重新部署后返回 200。登录、派生链接和 Worker WebSocket Upgrade 独立验收。Cloudflare 文档明确支持 Dashboard 拖放含 `_worker.js` 的 ZIP。实际验证项目在 Dashboard 创建，浏览器自动化的文件选择受权限限制，线上部署由 Wrangler 上传从 ZIP 解出的同一份模块完成。Dashboard 文件拖放的完整过程仍待实点确认。 [Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/) · [Advanced Mode](https://developers.cloudflare.com/pages/functions/advanced-mode/) · [Secret 生效](https://developers.cloudflare.com/pages/functions/bindings/#secrets)

## 上游实现与选择

- **默认使用 KWS。** 新的 `UpstreamRouter` 分别记录五个 DC 的普通与媒体流，每类仅保留两个官方候选的状态。30 秒内两次确认失败将候选冷却 15 秒。下次拨号优先尝试可用备选，冷却后允许一次前台探测。用户取消和输掉竞速不计入失败。若首选明确失败，仍尝试剩余官方入口。健康路径沿用原先的顺序和 900 ms 备用竞速，单 lane 最多两次出站，最多八个同时发生的备用竞速。两个端点均失败时终止该流。
- **TCP 仅用于独立实验。** 目标是 TDLib 的五个生产 IPv4 引导地址，端口固定 443，媒体及其他 DC 拒绝拨号。直连混淆头按 MTProto 规范保留随机尾部，按 transport tag 接续 CTR，保留原始帧中的 quick ACK 标志。TCP 上行等待 `WritableStream` 写入才归还额度，下行按客户端可用 WINDOW 和 WebSocket 缓冲读取，单个 BYOB 读最多 64 KiB。断开、读写错误和超时收敛为流关闭。媒体地址缺少等价的已验证配置，本轮正式路由范围保持在 KWS。
- **流边界。** KWS 保持完整 MTProto 包与消息边界，TCP 用连续字节流。每条流独立拥有 CTR 状态，已发出业务数据的连接不切换后端。新流握手仍遵循 `websocket-lanes` 的父会话语义。单 WebSocket 复用需要跨 isolate 协调同一会话的唯一连接，还会共享拥塞与故障范围。当前无绑定方案继续使用 lanes。 [Telegram WEB 载体协议](https://github.com/telegramdesktop/tproxy-server/blob/master/PROTOCOL.md#carrier-modes) · [MTProto 传输](https://core.telegram.org/mtproto/mtproto-transports#transport-obfuscation) · [官方 DC 地址](https://github.com/tdlib/td/blob/master/td/telegram/net/ConnectionCreator.cpp) · [Cloudflare TCP](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)

可控路由用例把主端点的确认失败设为 500 ms，备用握手设为 50 ms。前两次各用 550 ms 和两次出站，第三次用 50 ms 和一次出站。冷却后成功恢复主端点。失败时延与请求数改善由该故障模型验证。健康路径和公网故障成功率需结合真实流量。

## 在线 Pages 对照

同一隔离项目部署了旧 KWS、固定顺序的新 KWS、实验 TCP 和正式的自适应 KWS，所有部署先通过仅配置 `p` 的登录及链接校验。工作站按 DC 轮换版本，每个版本对五个普通 DC 各做三次。通过真实 WSS 握手和 Telegram `req_pq_multi`，以 `resPQ` 类型、完整帧与对应的随机 nonce 确认业务协议已回应。每个版本 15/15，四版总计 60/60 成功，超时 0。该请求是认证密钥建立的第一步，未使用 Telegram 账号或文件。域名不同、Cloudflare isolate 暖度和客户端网络会影响端到端结果。15 个样本的 P95 等于该版本实测最大值。

| 阶段 P50 / P95（ms） | 旧 KWS | 固定新 KWS | 实验 TCP | 自适应 KWS |
| --- | ---: | ---: | ---: | ---: |
| Bridge 页面和票据 | 1287 / 2633 | 1264 / 2650 | 1305 / 3645 | 1268 / 2384 |
| 到客户端 WebSocket Upgrade | 1606 / 2935 | 1571 / 2940 | 1621 / 3926 | 1585 / 2690 |
| 到首批转发 | 2651 / 3790 | 2412 / 4115 | 2364 / 4540 | 2393 / 3190 |
| 到完整有效 `resPQ` | 2651 / 3790 | 2412 / 4115 | 2364 / 4540 | 2393 / 3191 |
| 从 Upgrade 到有效 `resPQ` | 855 / 1731 | 848 / 2037 | 665 / 819 | 846 / 1141 |

| 从 Upgrade 到有效 `resPQ` 中位数（ms） | 旧 KWS | 固定新 KWS | 实验 TCP | 自适应 KWS |
| --- | ---: | ---: | ---: | ---: |
| DC1 | 871 | 858 | 687 | 851 |
| DC2 | 325 | 331 | 336 | 349 |
| DC3 | 855 | 860 | 665 | 871 |
| DC4 | 334 | 323 | 329 | 330 |
| DC5 | 1129 | 1148 | 813 | 1108 |

TCP 在 DC1、DC3、DC5 的 Upgrade 后阶段有可见收益。DC2、DC4 的中位数接近，TCP 的端到端尾部仍受客户端到 Pages 的等待影响。采样中正式版的 Bridge 页面本身约 1.27 秒，后续独立 Upgrade 的阶段中位数约 306 ms。Upgrade 到有效响应还包含上游建连、客户端首发与服务端响应。生产诊断另统计单实例 KWS 拨号时间。这批在线测试没有采到可比较的纯 TCP 拨号分位数、TCP 媒体下载、复用模式、真机故障重连或三网长期数据。四种模式都成功，正常网络样本无法证明自适应提高成功率。其收益已在确认主路连续失败的故障模型中复现。

## 本地对照

Windows、Node.js 24.16.0、Vitest 4.1.12。固定 `59aeb06`，传输预热后交替七轮，首连每版四十轮，模拟入站及上游。TCP 使用同负载的字节流夹具。每轮校验双向字节计数，KWS 另校验消息边界。下表为中位数，吞吐括号为七轮范围。 [首连基准](../benchmarks/startup.mjs) · [传输基准](../benchmarks/transport.mjs)

| 本地指标 | 旧 KWS | 新 KWS | TCP 实验 |
| --- | ---: | ---: | ---: |
| 冷首批转发 P50 / P95，ms | 7.49 / 8.78 | 7.57 / 8.58 | — |
| 热首批转发 P50 / P95，ms | 2.40 / 2.81 | 2.39 / 2.74 | — |
| 主入口立即失败后首批转发 P50 / P95，ms | 7.30 / 8.13 | 7.43 / 8.42 | — |
| 小包 P95，ms | 0.152 | 0.151 | 0.216 |
| 混合负载 P95，ms | 2.348 | 2.235 | 2.684 |
| 连续下载，MiB/s | 657.7 [380–769] | 662.3 [599–763] | 354.6 [329–405] |
| 连续上传，MiB/s | 1436.1 [1367–1540] | 1507.6 [1256–1633] | 1410.7 [1159–1512] |
| 连续下载 AES 调用 / 下发次数 | 256 / 128 | 256 / 128 | 512 / 256 |
| 连续下载 CPU 中位数，ms | 0 | 0 | 15 |
| 连续下载 ArrayBuffer 采样峰值中位数，MiB | 0 | 0 | 8.819 |

本机冷启动、热启动及立即主失败均 40/40 成功，快速票据无需额外 Session POST。下载 KWS 的范围重叠。实验 TCP 的读粒度让同负载增加 AES 调用和发送次数。Windows CPU 采样大多在 0 或约 16 ms 跳变，0 也可能是采样分辨率的结果。ArrayBuffer 峰值包含等待 GC 的分配。上述数值只覆盖本机热路径，Cloudflare 边缘实际 CPU、永久稳定性及媒体下载待实测。

## DNS、入口与地域

使用正常 Pages Custom Domain，先绑定域名并完成证书签发。Cloudflare 有托管 DNS 和子域外部 CNAME 两条路径，外部 DNS 的正式文档要求 CNAME 指向该项目的 `*.pages.dev`。Telegram 代理链接只有代理主机名和密钥。Worker 在请求到达后运行，入口 IP 由客户端解析、Cloudflare 网络和客户端连接共同决定。ZIP 内的代码与 Wrangler 的 Workers 地域配置不改变首次 TLS 的目标。 [Pages 自定义域](https://developers.cloudflare.com/pages/configuration/custom-domains/)

对 `cloudflare.182682.xyz` 的本机解析收到低 TTL CNAME 和若干 IPv4。使用隔离 Pages 域名和原域名 SNI，以 `curl --resolve` 对其中两个地址访问公开首页，三个方案各三次。所有请求均 HTTP 200，证书校验返回 0。默认 DNS、104.25.255.183、162.159.194.144 的 TLS 完成中位数分别约 938、1168、2187 ms。首字节中位数分别约 1271、1498、2472 ms。单工作站这次对照未获收益。没有使用第三方 CNAME 承接原域名，也没有向它发送密码或代理凭证。

Pages Smart Placement 可在 **设置 → 运行时** 手动启用。它改变 Functions 执行位置。Workers 的显式地域提示针对特定后端位置，香港、东京和新加坡的区域配置仅适用独立 Workers 实验。默认采用 Pages 的默认放置。是否启用 Smart Placement 应比较三网的首批有效数据、长连接断线和持续吞吐。当前缺少对照。管理页的 `request.cf.colo` 是请求机房标识，RTT 是 Cloudflare 提供的本次连接数据。新按钮由已登录用户主动发起五次同源 HEAD，报告浏览器 HTTPS 往返，包含页面鉴权和连接复用成本。 [Pages Smart Placement](https://developers.cloudflare.com/pages/functions/smart-placement/) · [Workers Placement](https://developers.cloudflare.com/workers/configuration/placement/)

## 参考实现核对

| 项目 | 本轮参考 |
| --- | --- |
| [edgetunnel](https://github.com/cmliu/edgetunnel/blob/main/_worker.js) | GPL-2.0。核对 TCP 失败回退和 ZIP 入口。其 VLESS 类协议具备独立连接目标和 Host 的配置边界。 |
| [tg-ws-proxy-rs](https://github.com/valnesfjord/tg-ws-proxy-rs/blob/main/src/check.rs) | MIT。参考分 DC 路径记忆，以及发送真实 `req_pq_multi` 并验证响应的测量方法。 |
| [tg-proxy](https://github.com/AlexMelanFromRingo/tg-proxy/blob/main/src/route.rs) | MIT。参考按流区分路径和确认失败后有限冷却。 |
| [cfnew](https://github.com/byJoey/cfnew/blob/core-only/scripts/package-release.py) | GitHub 未识别许可证。参考独立 Release 资产与 SHA-256 的分发形式。 |
| [cftgwebproxy](https://github.com/xinyitang3/cftgwebproxy) | MIT。核对 Pages、附加 Worker 与 DNS 自动化的依赖边界。当前仓库只使用单 Pages。 |
| [CheckProxyIP](https://github.com/cmliu/CF-Workers-CheckProxyIP/blob/main/_worker.js) | GPL-3.0。参考拆分 TCP、TLS 与 HTTP 计时，使用自行控制的测试入口。 |
| [ToiCF](https://github.com/ToiCF/CF-Workers-TGProxy) | GPL-3.0。本项目已有代码来源，沿用历史许可及署名。 |
| [CloudflareSpeedTest](https://github.com/XIU2/CloudflareSpeedTest/blob/master/task/tcping.go) | GPL-3.0。参考从用户设备重复测量、记录成功数的方法。 |
| [tproxy-server](https://github.com/telegramdesktop/tproxy-server/blob/master/PROTOCOL.md) | 参照官方协议文档及载体实现。路由和打包代码独立编写。 |

## 安全和平台验收

- 上游目标为固定、经过验证的 Telegram 域名或实验静态表。KWS 保留 HTTPS 证书校验、禁止重定向并验证 `binary` 子协议。TCP 采用 Telegram 规范的原生传输，只可通过独立实验入口构建。无公开任意地址转发接口、后台探测或外部 DNS 写入。
- ZIP 内容验证只接受公开源码。密钥派生参数、域名绑定、HMAC、票据有效期、跨实例撤销限制、窗口、资源预算和旧 Cookie 范围沿用既有实现。管理页探测须有有效 Cookie，返回无内容 204。页面仅允许同源探测。
- Pages Functions 计入 Workers 配额。Free 当前每账户每日 100,000 次请求，每次 HTTP 调用 10 ms CPU，每实例内存上限 128 MB。应用仍限制单方向、lane、会话与 isolate 的积压。Pages 线上小样本跑通和本机 workerd 通过可以确认功能，持续高负载是否触及线上配额需要实测。 [Pages Functions 计费](https://developers.cloudflare.com/pages/functions/pricing/) · [Workers 限额](https://developers.cloudflare.com/workers/platform/limits/)

## 复现命令

```sh
npm ci
npm test
npm run test:runtime
node --check dist/verified/_worker.js
npm run bench -- --tcp --against=59aeb06b19ed24b90555ce3d88de668410e0ebb5
npm run bench:startup -- --against=59aeb06b19ed24b90555ce3d88de668410e0ebb5
```

`npm run test:runtime` 同时构建并校验 ZIP。线上探针对隔离 `pages.dev` 项目使用新生成的测试密码、合成 MTProto 请求以及公开 DC，脚本仅输出状态和阶段耗时。 [线上探针](../experiments/probe-pages.mjs)
