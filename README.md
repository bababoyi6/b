# Telegram WEB 代理

在 Cloudflare Workers 运行个人 Telegram WEB 代理。使用支持 **WEB 代理**的 Telegram 客户端。

## 部署到 Workers

1. 从 Release 的 **Assets** 下载 `telegram_webproxy.js`。也可下载 `Workers.zip` 并解压得到同一文件。 [发布资产](https://github.com/bababoyi6/b/releases/latest)
2. 在 Cloudflare Dashboard 打开 **Workers 和 Pages → 创建应用 → 从 Hello World! 开始**，创建并部署一个 Worker。选 **编辑代码**，全选替换入口代码为下载的 JS，再点 **部署**。Workers 新建界面的静态文件上传用于静态资产，部署这个 Module Worker 使用代码编辑器。 [Workers Dashboard](https://developers.cloudflare.com/workers/get-started/dashboard/) · [Static Assets](https://developers.cloudflare.com/workers/static-assets/)
3. 在 Worker 的 **设置 → 变量和密钥** 添加小写的 `p`，类型选 **Secret**，填写至少 16 字符的独立密码并保存部署。 [Workers Secret](https://developers.cloudflare.com/workers/configuration/secrets/)
4. 在 **设置 → 域和路由** 添加 **自定义域**。证书生效后打开 `https://你的域名/admin`，登录并复制 `tg://webproxy` 链接，然后在 Telegram 添加。 [Workers 自定义域](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

新 Worker 使用 Cloudflare 默认执行位置，创建时只需设置 `p`。正式上游为 Telegram 官方 KWS。登录后，**连接诊断**可以查看当前 isolate 的握手、首批转发与缓冲统计。

## 更新和回滚

只用 `p` 的同域名部署保留相同密码即可继续使用已生成的链接。更新时在编辑器替换完整 JS。需要回退时，在 Worker 的 **部署** 里选择上一正常版本并回滚。 [Workers 回滚](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)

从 v0.3.0 起，所有新代理连接和管理操作都要求有效的 `p`。使用历史种子的部署可以保留原种子以维持原链接，并改用 `/admin` 登录。

[本版性能、认证与 cfnew 对照](./docs/cfnew-study.md) · [Workers 免费额度与先前验收](./docs/workers.md) · [历史 Pages 版本](https://github.com/bababoyi6/b/releases/tag/v0.1.0-pages.1) · [Pages 实验记录](./docs/pages.md)

按 [GPL-3.0](./LICENSE) 分发。
