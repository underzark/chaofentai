# 给部署 agent 的指南

## 准备与创建
1. 读取当前官方 Sites 技能，确认账号支持 Sites、D1、R2 和私人 MCP 插件。不得借用作者站点或凭据。
2. 用本候选创建独立私有工作副本，先运行 TESTING.md 的无费用检查。Node 24 已用于测试；依赖和模型能力需按当前官方资料核对。
3. 按官方创建流程建立新的 owner-private Site。`.openai/hosting.json` 只有 DB / BUCKET / mcp 声明，不包含个人项目 ID；在私有工作副本中由官方流程完成绑定。构建产物为 dist，默认导出 Worker fetch。用当前 Sites 原生 source/build/deploy 工作流发布，不能猜项目 ID 或自行替换身份头。
4. 按 drizzle/meta/_journal.json 顺序应用 0000 至 0009 全部迁移（包含 0006_manual_trial）。确认 manual_approvals、work_quotes、资产存储/引用触发器存在。不能把新副本迁移失败忽略为“已有表”。

## 配置（初始全部关闭）
`.env.example` 是配置说明，不是已配置服务。LIVE_ENABLED、POLL_ENABLED、WORK_ENABLED、HISTORY_RETENTION_ENABLED 均先 false。
设置 MANUAL_MODE=per_order，稳定且独立的 MANUAL_MODE_ID / WORK_MODE_ID（1–40 位字母数字下划线或连字符）。MANUAL_ACK_UNKNOWN_IDS 初始 []，不能复制其他人的未知任务豁免。

用自己已登录身份上传合成小图，经官方 Sites 数据库只读工具读取该资产的 Site-scoped owner，填入 MANUAL_TRIAL_OWNER。不能用 GitHub ID / 常规账号 ID 替代，不能伪造认证头。通过正常页面/API/MCP 验证 owner 隔离及下载鉴权。

副标题 STUDIO_SUBTITLE 优先使用部署 agent 名字，其次用户名；两者未知时询问，不编造姓名。通用 Logo 可保留。

用户通过自己 Site 的安全配置界面设置 OPENAI_API_KEY 为 secret，只配置一次。遵循当前 OpenAI Developers 凭据流程；不索取聊天明文 key、不写进源代码/浏览器/日志。当前路径需要 Responses 创建/读取及使用图像工具对应模型的权限；不需要账务管理员权限，也不新增 Files 上传路径。按实际项目权限验证，拒绝时先报告，不自行扩权。

## 开启前验收
跑全套 mock、workerd、构建/产物检查，做合成上传→保存→原字节下载 SHA 校验、跨 owner 拒绝、取消确认不提交、重复点击/未知提交不重发。通过官方 Library 流程验证 Work 原生附件交付；私有 URL 本身不等于原生附件。

检查所有页面/API/MCP/下载仍 owner-private；R2 不公开；敏感错误已脱敏。本地 workerd 不是托管 128MiB 内存峰值或真实手机行为保证。没有付费测试时应如实标注新副本真实生成未验证。

用户明确同意日常启用后，才开启 LIVE_ENABLED / POLL_ENABLED；网页仍逐单确认。另经用户同意开启 WORK_ENABLED；Work 必须使用 prepare/confirm 路径，不复用网页授权。用户确认不可恢复删除规则后才开启 HISTORY_RETENTION_ENABLED；启用本身不主动清理现有数据，不进行生产清理验收。

真实生图验收必须另获选定文件、方案、尺寸、模型、1张和费用范围的明确授权。只提交一次；未知时保存记录并调查，不换幂等键重新收费。停止使用时可关运行开关，保留任务与资产以便调查。

## 交付与维护
遵守 WORK-GUIDE.md；小文件整读，大文件显式 4MiB 块，失败同 offset 小块回退，在执行层拼接并核验 SHA，再由支持的 Library 通道输出附件。禁止公开文件或转移鉴权令牌。
更新代码前备份/审查迁移，保留历史真实模型/费用。公开发布只用未绑定的干净候选，不推私人工作副本、日志、用户文件或原开发历史。
