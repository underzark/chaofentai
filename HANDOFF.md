# 维护交接
当前产品行为以 README.md、AGENT-DEPLOY.md、WORK-GUIDE.md 为准。
生产逻辑在 worker/，迁移在 drizzle/，无费用回归在 scripts/ 与 runtime-tests/。默认协调模型 gpt-6.1-terra，默认图像模型 gpt-image-2.5-sunburst；仅用户明确要求快速时 Flare。只返回一张完整原 PNG。
修改授权、幂等、租约、资产引用或删除路径必须独立复核；不因 UI 更新重写历史。测试使用 fake transport，禁止把付费探测作为默认测试。错误未知不自动重发。
