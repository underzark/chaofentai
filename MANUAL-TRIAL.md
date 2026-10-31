# 可选单次试验模式
新副本优先按 AGENT-DEPLOY.md 使用日常逐单模式。本文件仅说明代码保留的限时一次授权兼容路径，不是部署必需步骤。
若确需单次模式，应由审查者核对 worker/manual-trial.mjs 的 MANUAL_TRIAL_ID、MANUAL_TRIAL_OWNER、MANUAL_TRIAL_EXPIRES_AT 和固定任务规则，再给具体一次授权；不要复制任何原实例记录，不能无界重置额度。真实试验须另获用户明确同意，不由安装或 @插件 自动授权。
