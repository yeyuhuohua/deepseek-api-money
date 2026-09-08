# deepseek-api-money

在 DeepSeek Harness Web GUI 对话界面底部统计栏显示 **DeepSeek API 余额** 和 **当前会话花费** 的持久化插件。

显示位置：对话界面底部统计栏（「2 轮 · 41 步 · …」那行所在的区域），插件在该统计行下方追加一行：

```
余额 ¥86.86 · 本会话 ≈¥0.05
```

- **余额**：实时查询 DeepSeek 官方余额接口（每 60 秒自动刷新，**点击该行立即刷新**）
- **本会话花费**：根据当前会话累计 token 用量（未缓存输入 / 缓存读 / 缓存写 / 输出）按 DeepSeek 官方价目实时估算，随对话自动增长
- **悬停 tooltip** 显示明细：充值/赠送金额、输入/缓存读/输出 token 数、美元估算值、计价模型与峰谷时段

---

## 目录结构

```
deepseek-api-money/
├── package.json        # 包声明：dsh.client 双面包（web 平台）
├── lib/
│   ├── index.js        # Host 半：GET /deepseek-api-money/status 余额接口
│   └── client.js       # Client 半：ModuleLoader bundle，渲染底部徽章
└── README.md           # 本文档
```

---

## 前置条件

1. **DeepSeek API Key**：配置在 `~/.dsh/.credentials.yaml`（格式 `DEEPSEEK_API_KEY: sk-...`）或环境变量 `DEEPSEEK_API_KEY`。密钥只在 Host 侧使用，不会发送到浏览器。
2. **curl**：宿主机能执行 `curl`（macOS/Linux 自带）。
3. **DSH Web GUI**：已通过 `dsh web` 运行（使用 `web` profile）。

---

## 安装（新机器部署）

### 1. 放置代码

把本文件夹放到任意位置，例如 `~/code/deepseek-api-money/`。

### 2. 创建符号链接

让 DSH 的 profile 能解析到这个包：

```bash
mkdir -p ~/.dsh/profiles/web/node_modules
ln -sfn /你的路径/deepseek-api-money ~/.dsh/profiles/web/node_modules/deepseek-api-money
ln -sfn /你的路径/deepseek-api-money ~/.dsh/profiles/node_modules/deepseek-api-money
```

### 3. 在 profile patch 层挂载插件行

编辑 `~/.dsh/profiles/web/cordis.patch.yml`，加入：

```yaml
- insert:
    - id: deepseek-api-money
      name: deepseek-api-money
```

### 4. 生效

- **热加载**：`cordis.patch.yml` 被 HMR 监听，通常改完自动生效；若没反应，**追加一行注释**再保存（实测追加比整文件重写更可靠触发 watcher），或直接重启 dsh。
- **重启 dsh** 后也一定生效。
- **刷新浏览器页面**（必须刷新一次，新的客户端 bundle 才会被加载）。

> 注意：**修改 `lib/client.js` / `lib/index.js` 后需要重启 dsh**（bundle 内容在挂载时哈希缓存）。

---

## 使用说明

| 交互 | 行为 |
| --- | --- |
| 自动 | 每 60 秒刷新一次余额 |
| 点击徽章 | 立即刷新余额 |
| 悬停徽章 | 显示详细 tooltip（充值/赠送、token 明细、美元估算、峰谷时段） |
| 键盘 | 徽章可聚焦，按 Enter / 空格刷新 |

**显示内容解读**：

- `余额 ¥86.86` — 账户总余额（充值 + 赠送，CNY）
- `本会话 ≈¥0.05` — 当前这个会话从开始到现在消耗的估算金额
- 获取失败时显示 `余额获取失败 · 点击重试`，不影响原统计行

---

## 可调参数

都在 `lib/client.js` 顶部：

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `DEFAULT_MODEL` | `"deepseek-v4-pro"` | 兜底计价模型（仅在无法获知当前模型时使用，见下方「模型自动跟随」） |
| `CNY_PER_USD` | `7.2` | USD→CNY 汇率（官方价目为美元，余额为人民币） |
| `REFRESH_MS` | `60000` | 余额自动刷新间隔（毫秒） |

改完重启 dsh 生效。

---

## 计价规则

价格表（美元 / 百万 token，**谷价**；峰价为谷价 ×2）：

| 项目 | deepseek-v4-flash | deepseek-v4-flash-vision-exp | deepseek-v4-pro |
| --- | --- | --- | --- |
| 输入（缓存未命中） | $0.22 | $0.22 | $0.66 |
| 输入（缓存命中） | $0.007 | $0.007 | $0.022 |
| 输出 | $0.66 | $0.66 | $1.98 |

> **视觉模型**（`deepseek-v4-flash-vision-exp`，实验性）：价目与 v4-flash 完全一致。发送的图片会先按尺寸缩放（约 800×800 像素总量），换算为**输入 token** 与文字一起计费，**每张图上限 384 token**、每张独立计数（[Vision 文档](https://api-docs.deepseek.com/guides/vision)）。

- **峰时**：UTC 01:00–04:00 与 06:00–10:00（其余为谷时，半价）
- **花费公式**：`(未缓存输入 + 缓存写) × miss 价 + 缓存读 × hit 价 + 输出 × out 价`，再按峰谷时段乘系数，最后按 `CNY_PER_USD` 换算成人民币（图片 token 已计入会话的输入 token 统计，无需额外计算）
- 数据来源：会话 `tokenUsage` 投影（全日志累计，压缩后仍保持）
- 价格来源：[DeepSeek 官方价目页](https://api-docs.deepseek.com/quick_start/pricing)，官方调价后请手动更新 `PRICES` 表

### 模型自动跟随

计价模型**自动跟随当前选择的模型**，无需手动改代码。解析顺序：

1. **模型选择器当前选中的模型**（经 `ctx.modelDirectories` 共享目录读取）——切换模型后徽章**立即**按新模型价格重算，不用等下一轮对话
2. **最近一轮 assistant 消息实际使用的模型**（节点 `provenance`/`requestConfig`）——当前选中值尚未加载时使用
3. **`DEFAULT_MODEL` 兜底**——以上都拿不到时使用

- 当前模型在 `PRICES` 表内（`deepseek-v4-pro` / `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp`）→ 正常估算（视觉模型按 flash 价目）
- 当前模型不在表内（如切到其他厂商模型）→ 显示 `本会话 · <模型名> 无价目`，不显示金额；把该模型价格加进 `PRICES` 表即可启用
- 悬停 tooltip 会显示实际参与计价的模型名

### 已知限制（估算口径）

1. 金额是**估算值**：汇率、峰谷时段为本地配置，可能与实际账单有细微出入
2. 会话中途切换模型时，历史 token 统一按**当前模型**价格计价（token 投影不带模型维度，无法分模型拆账）
3. **子代理（subagent）会话**的用量记在各自的会话里，不计入父会话的「本会话」金额
4. 余额接口按官方返回展示（含赠送额度），与扣费明细可能有分钟级延迟

---

## 工作原理

```
浏览器 ──(1) 加载 /plugins/deepseek-api-money/client.js  bundle
        │       在 conversation.composer.dock 注册徽章
        ├──(2) fetch('/deepseek-api-money/status') ──────────► Host
        │        Host: credentials 取 key ─► curl 官方余额接口（30s 缓存）
        │◄─────────────── JSON {kind:"ok", total, ...} ───────┤
        └──(3) 当前模型（modelDirectories/节点 provenance） + useProjection("tokenUsage")
               ─► 本地计价 ─► 渲染（切换模型立即重算）
```

- 采用 DSH 官方**双面包持久化插件**机制（`dsh.client` 声明 + `window.__ModuleLoader__` bundle），与产品自带 UI 插件同架构，随 dsh 启动自动挂载，任何会话都生效
- 密钥永不进入浏览器：只在 Host 侧经 `credentials` 服务解析，并通过**环境变量**传给 curl，不出现在命令行参数中
- 余额接口 Host 侧缓存 30 秒，浏览器侧 60 秒轮询，不会触发官方限流

---

## 故障排查

| 现象 | 处理 |
| --- | --- |
| 徽章显示「余额获取失败 · 点击重试」 | 悬停看具体原因：未配置 key → 检查 `~/.dsh/.credentials.yaml`；沙箱拒绝 → 检查 dsh 启动权限 |
| 改了 `cordis.patch.yml` 没生效 | 追加一行注释保存再试；或重启 dsh |
| 改了 `lib/*.js` 没生效 | 必须重启 dsh（bundle 挂载时哈希缓存，热加载不覆盖） |
| 页面里没有徽章 | 先确认刷新过页面；再看 `curl http://127.0.0.1:3080/ | grep deepseek-api-money` 是否在 boot 清单中 |
| 双份徽章 | 之前跑过同名动态插件且未停止；重启 dsh 或 `cordis_stop` 对应动态插件 |
| 余额明显不符 | 检查 `PRICES` 是否与[官方价目](https://api-docs.deepseek.com/quick_start/pricing)同步、`CNY_PER_USD` 汇率是否最新 |

---

## 卸载

1. 删除 `~/.dsh/profiles/web/cordis.patch.yml` 中的 `deepseek-api-money` 行
2. 删除两个符号链接：
   ```bash
   rm -f ~/.dsh/profiles/web/node_modules/deepseek-api-money \
         ~/.dsh/profiles/node_modules/deepseek-api-money
   ```
3. 重启 dsh；本文件夹可保留作为源码备份

---

## 版本历史

- v1（动态插件 `dsmon-1/pkg-1`）：会话级临时插件，进程重启即消失
- v1 持久化（包名 `dsh-money`）：位于 `~/.dsh/profiles/web/packages/dsh-money`，已废弃删除
- v1 重命名：包名改为 `deepseek-api-money`，源码迁移至本文件夹，profile 以符号链接指向这里
- v1.1：计价模型自动跟随当前选择的模型（`modelDirectories` → 节点 provenance → 兜底）
- v1.2：新增视觉模型 `deepseek-v4-flash-vision-exp` 价目（同 v4-flash，图片每张上限 384 token 计入输入）
- v1.2.1（当前）：适配 DSH 0.1.2+ 快照结构变化——聊天节点改经 `useChat` hook 读取（旧 `useSession().chat` 已废弃，会导致徽章渲染崩溃）
