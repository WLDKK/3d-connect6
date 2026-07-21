# 3D Connect6

一个以 10×10×10 空间棋盘为核心的六子棋项目。当前版本采用完全离线的本地战术引擎，并保留由 Cloudflare Durable Objects 提供的双人实时对战。

## 主要能力

- 13 个三维成线方向的完整胜负判定与满盘和棋
- 两子整回合组合搜索：兼顾进攻、防守、断点、开放线、空间斜线与对手应手
- Web Worker 后台计算，主线程保持可交互；同一局面输出确定性着法
- 3D 直接点选、坐标输入、遮挡透视、切片监视和按回合复盘
- 首局随机执色、重赛轮换颜色、90 秒持久回合时钟和双方确认重置
- 无外部大模型、无云端 AI 推理接口、无模型密钥

## 本地开发

```bash
npm install
npm run dev
```

多人服务另开终端：

```bash
npm run dev:server
```

## 质量检查

```bash
npm run check
```

该命令依次执行战术/规则测试、共享层构建、客户端生产构建与服务端类型检查。详细棋规见 [RULES.md](./RULES.md)。

## 工程结构

```text
packages/client  React + React Three Fiber 前端
packages/shared  规则引擎、本地 AI、共享协议与测试
packages/server  Cloudflare Worker 与 Durable Object 房间
```
