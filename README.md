# Telegram WEB 代理

在 Cloudflare 上搭自己的 Telegram WEB 代理。你需要一个已经接入 Cloudflare 的域名，以及支持 **WEB 代理**的 Telegram 客户端。

**Worker 的源码是 `telegram_webproxy.js`。** 如果要在 Cloudflare 控制台直接粘贴，先按下面的步骤生成控制台部署版。[打开 JS 文件](./telegram_webproxy.js)

## 第一次部署

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/bababoyi6/b)

1. 点部署按钮，按提示连上 GitHub。密钥 `p` 填你自己设的密码，至少 16 个字符。Cloudflare 会为 Worker 创建保存后台密钥的空间。
2. 在 Worker 的 **设置 → 域名和路由 → 添加 → 自定义域名** 里绑定域名，例如 `tg.example.com`。[Cloudflare 域名设置](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
3. 访问自己的域名会看到 **Welcome to nginx!**。打开域名后的 `/admin` 并输入密码。Worker 会在首次登录时生成并保存后台密钥。点 **打开 Telegram** 或 **复制链接**，在 Telegram 里确认添加并开启代理。

用命令行部署时，在项目目录运行 `npm ci` 和 `npx wrangler deploy`，然后用 `npx wrangler secret put p` 设置登录密码。[Cloudflare 密钥设置](https://developers.cloudflare.com/workers/configuration/secrets/)

## 控制台粘贴部署

1. 下载 `telegram_webproxy.js` 和 `prepare-dashboard.html`。打开下载到本地的 HTML 文件，选中 JS，点 **生成并下载 JS**。[Worker 源码](./telegram_webproxy.js) · [生成工具](./prepare-dashboard.html)
2. 把生成的 `telegram_webproxy.dashboard.js` 内容粘贴到 Cloudflare Worker 编辑器，设置小写的 `p` 为 **密钥**，保存并部署。打开域名后的 `/admin` 登录。
3. 把生成的 JS 留在本地。更新时在生成工具里选中上次的文件，原来的代理链接就能继续用。

## 遇到问题

- **打开 `/admin` 提示 404**。检查域名是否绑定到了这个 Worker，以及小写的 `p` 是否按密钥类型保存，长度是否足够。
- **密码正确，登录后提示需要部署配置**。控制台里可能粘贴了仓库源码。换成生成后的 `telegram_webproxy.dashboard.js`，或者通过一键部署或 Wrangler 创建存储绑定。
- **Telegram 找不到 WEB 代理**。检查客户端版本是否支持。可以先在电脑端试。
- **能连但下载慢**。登录后点 **连接诊断** 看哪一段花时间。测速度时，用同一台电脑、同一条网络下载未缓存的文件。

[亚太配置（香港、东京、新加坡）](./wrangler.apac.jsonc) · [测试记录](./docs/audit.md)

按 [GPL-3.0](./LICENSE) 分发。
