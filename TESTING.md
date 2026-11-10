# 无费用测试
Node 24：`npm test`（16 组产品回归及新副本迁移检查）、`npm run build`、`npm run validate`。这些测试不得使用真实 API key。

可选真实 Worker 运行时测试：
```sh
npm --prefix runtime-tests install
python runtime-tests/fixtures.py
node runtime-tests/test.mjs
```
Python 需要 Pillow。Miniflare 版本固定在 runtime-tests/package.json。fixture 均为合成数据；测试拒绝上游生成 POST，不使用远程 D1/R2。此证据不等于托管资源峰值或手机真机验收。

`node scripts/preview.mjs` 启动仅 loopback 内存预览，自动应用完整迁移。假身份仅用于本地；不读取 .env 或真实凭据。关闭进程后数据消失。勿公开代理此预览。

发布前：审查源码/压缩包的文件清单，排除 .env、私有项目 ID、个人路径、用户图片、日志、运行数据库和旧 Git 历史。新部署须独立验证认证、合成文件 SHA、Work 工具发现和附件交付。真实付费测试另行逐单确认。


## GIF 动画

网页 `/gif` 与 Work 共用逐单确认后端。使用 `canvas_gif_options`、`canvas_prepare_gif`、`canvas_confirm_gif`、`canvas_get_gif`、`canvas_gif_history`；交付原 GIF，不走 PNG 超分流程。完整参数、限制、费用与免费测试见 [GIF-GUIDE.md](GIF-GUIDE.md)。
