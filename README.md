# Telegram WEB 代理

在 Cloudflare Pages 部署个人 Telegram WEB 代理。发布包已构建，运行只需要一个 `p` Secret。客户端需要支持 **WEB 代理**。

## 从 Dashboard 上传

1. 在 GitHub Releases 的 **Assets** 下载 **Pages.zip**。同一页面的 **Source code (zip)** 是开发源码。需要核对下载文件时，使用旁边的 `SHA256SUMS.txt`。[下载发布包](https://github.com/bababoyi6/b/releases)
2. 在 Cloudflare Dashboard 打开 **Workers 和 Pages → 创建应用 → 继续前往 Pages → 拖放文件**。创建直接上传项目，选择 `Pages.zip` 并部署。包的根目录只有 Advanced Mode 的 `_worker.js`。[Pages 直接上传](https://developers.cloudflare.com/pages/get-started/direct-upload/)
3. 打开 Pages 项目的 **设置 → 变量和密钥**。在 **生产** 环境添加小写的 `p`，选择 **Secret / 加密**。使用独立的高熵密码，至少 16 个字符。保存后，在 **部署 → 创建新部署** 再上传同一份 ZIP，让新部署读取 `p`。[Pages Secret](https://developers.cloudflare.com/pages/functions/bindings/#secrets)
4. 在项目的 **自定义域** 标签绑定域名，等 Cloudflare 激活证书。打开 `https://你的域名/admin` 登录，点 **复制链接** 或 **打开 Telegram**，在 Telegram 确认添加后开启代理。[Pages 自定义域](https://developers.cloudflare.com/pages/configuration/custom-domains/)

## 升级和回滚

新旧部署都只用 `p` 时，相同域名和密码会派生同一把代理密钥，原链接可以继续使用。可以先在新项目的 `*.pages.dev` 验证再迁移原域名。预览域名有自己的链接。

使用旧随机种子、`PROXY_SEED`、`PORTAL_KEY` 或 Durable Object 的部署，迁移前须保留原来的密钥来源。既有随机种子可以继续用对应 Secret。需要切换回旧 Worker 时，恢复原有域名路由。Pages 内的版本回滚可在 **部署** 页面选回先前正常版本。[密钥兼容性](./docs/audit.md#密钥来源与回滚) · [Pages 回滚](https://developers.cloudflare.com/pages/configuration/rollbacks/)

## 遇到问题

- **打开 `/admin` 提示 404**。检查域名是否绑定到了该 Pages 项目、生产 Secret 名是否为小写的 `p`，以及保存后是否重新部署。
- **Telegram 找不到 WEB 代理**。检查客户端版本是否支持。可以先在电脑端试。
- **能连但下载慢**。登录后点 **连接诊断** 查看当前实例的阶段统计，或从当前浏览器测量五次 HTTPS 往返。对照下载时，用同一设备和同一条运营商线路下载未缓存的文件。

[Pages 架构、实验和验收](./docs/pages.md) · [历史工程记录](./docs/audit.md)

按 [GPL-3.0](./LICENSE) 分发。
