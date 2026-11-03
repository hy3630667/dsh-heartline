# dsh-heartline

心跳急救的插件半边。三份证据互相印证：

- `host.beat.json` 每秒一份，带 `seq`、`mono_ms`、`tick_lag_ms`（事件循环有没有被堵）
- 网页每 5 秒 POST 一次 `/dsh-heartline/face`（界面卡死时这个会断）
- `ack_nonce`：读到外部本体（`C:\ProgramData\DSH-Heartline`）的心跳就把它的 nonce 抄回来，构成双向通

插件**不**杀进程、**不**拉进程、不改配置。判定权在外部本体和看护手里——证人不能给自己打分。

## 路由

- `GET /dsh-heartline/status` 三份心跳的年龄与状态
- `GET|POST /dsh-heartline/config` 阈值与开关
- `POST /dsh-heartline/face` 网页脚印
- `GET /dsh-heartline/events` 最近事件

## 设置

设置左侧栏「心跳急救」：看状态、改心跳间隔与判死阈值。自动急救默认关。
