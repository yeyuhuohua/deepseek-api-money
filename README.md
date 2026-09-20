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
| 自动 | 每 60 秒刷新一次余额（走宿主 30 秒缓存，避免触发官方限流） |
| 点击徽章 | **强制刷新**：跳过宿主缓存，立即真查官方接口（显示「余额 刷新中…」作为反馈） |
| 悬停徽章 | 显示详细 tooltip（充值/赠送、token 明细、模型与单价、峰谷时段、美元参考、最后更新时间） |
| 键盘 | 徽章可聚焦，按 Enter / 空格强制刷新 |

**显示内容解读**：

- `余额 ¥86.86` — 账户总余额（充值 + 赠送，CNY）
- `本会话 ≈¥0.05` — 当前这个会话从开始到现在消耗的估算金额
- 获取失败时显示 `余额获取失败 · 点击重试`，不影响原统计行

---

## 可调参数

都在 `lib/client.js` 顶部：

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `DEFAULT_MODEL` | `"deepseek-flash"` | 兜底计价模型（仅在无法获知当前模型时使用，见下方「模型自动跟随」） |
| `CNY_PER_USD` | `6.8` | 仅用于 tooltip 里的**美元参考**换算；价目本身用官方人民币价目 |
| `REFRESH_MS` | `60000` | 余额自动刷新间隔（毫秒） |

改完重启 dsh 生效。

---

## 计价规则

价格表（**元 / 百万 token，谷价**；峰价为谷价 ×2）——2026-09-10（DeepSeek-V4.1-Flash 发布）起生效：

| 项目 | deepseek-flash | deepseek-v4-pro |
| --- | --- | --- |
| 输入（缓存未命中） | ¥1 | ¥4.5 |
| 输入（缓存命中） | ¥0.02 | ¥0.15 |
| 输出 | ¥4 | ¥13.5 |

> 官方同时公布美元价（Flash $0.15 / $0.003 / $0.6，Pro $0.66 / $0.022 / $1.98）。本插件直接采用**人民币价目**，与余额、实际扣费口径一致，不再做汇率换算；tooltip 里的美元数字只是按 `CNY_PER_USD` 的参考值。

### 模型 id 与计费对应

官方 2026-09-10 起：V4-Flash 与 V4-Flash-Vision-Exp **已下线**，旧模型名仍可调用，由 V4.1-Flash 承接并按 Flash 价目计费。

| 模型 id | 实际承接模型 | 计费 |
| --- | --- | --- |
| `deepseek-flash` | DeepSeek-V4.1-Flash（原生多模态） | Flash 价目 |
| `deepseek-v4-flash`（旧名） | 同上（官方兼容路由） | Flash 价目 |
| `deepseek-v4-flash-vision-exp`（旧名） | 同上 | Flash 价目 |
| `deepseek-v4.1-flash-expires-on-0910`（内部 beta 名） | 同上 | Flash 价目 |
| `deepseek-v4-pro` | DeepSeek-V4-Pro-0813（官方继续提供服务） | Pro 价目 |

- **峰时**：**北京时间**周一至周五（不含中国法定节假日）09:00–12:00、14:00–18:00
- **谷时**：其余全部时间（**含周末、调休上班的周末与法定节假日全天**），价格为峰时的一半
- **视觉**：`deepseek-flash`（V4.1-Flash）原生支持图片。图片按尺寸换算成**输入 token** 与文字一起计费——小于约 544×544 的图片会被放大，更大的会缩放到约 1300×1300 等效像素，**每张上限 1024 token**、每张独立计算（[图像理解文档](https://api-docs.deepseek.com/zh-cn/guides/vision)）
- **花费公式**：`(未缓存输入 + 缓存写) × miss 价 + 缓存读 × hit 价 + 输出 × out 价`，再乘峰谷系数；图片 token 已并入会话的输入统计，无需额外计算
- **扣费顺序**：充值余额与赠送余额同时存在时，官方**优先扣减赠送余额**（tooltip 里两项都列出）
- **调休上班的周末**：DeepSeek 平台公告明确「调休上班的周末、中国法定节假日全天均按空闲时段计费」，所以判定只看**周几 + 是否法定节假日**——调休要上班的周六/周日一样算谷时（tooltip 会标注「谷时（调休上班日）」，内置 2026 年调休表 `CN_MAKEUP_DAYS`）
- 数据来源：会话 `tokenUsage` 投影（全日志累计，压缩后仍保持）
- 价格来源：[模型 & 价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)，官方调价后请手动更新 `PRICES`、`MODEL_ALIASES`、`CN_HOLIDAYS`、`CN_MAKEUP_DAYS`

### 模型自动跟随

计价模型**自动跟随当前选择的模型**，无需手动改代码。解析顺序：

1. **模型选择器当前选中的模型**（经 `ctx.modelDirectories` 共享目录读取）——切换模型后徽章**立即**按新模型价格重算，不用等下一轮对话
2. **最近一轮 assistant 消息实际使用的模型**（节点 `provenance`/`requestConfig`）——当前选中值尚未加载时使用
3. **`DEFAULT_MODEL` 兜底**（`deepseek-flash`）——以上都拿不到时使用

- 现役模型 id（`deepseek-flash` / `deepseek-v4-pro`）→ 精确匹配官方价目
- 旧名 / 内部 beta 名（`deepseek-v4-flash`、`deepseek-v4-flash-vision-exp`、`deepseek-v4.1-flash-expires-on-XXXX`）→ 走 `MODEL_ALIASES`，按承接模型的价目计费，tooltip 会写明「已由 deepseek-flash 承接」
- 表外的 **DeepSeek** 新模型（id 里含 `flash` 或 `pro`）→ 按名称推定价目，tooltip 标注「该模型 id 未单列，按 … 价目估算」
- 其他厂商模型（如 `gemini-2.5-flash`）→ 显示 `本会话 · <模型名> 无价目`，**不会**误用 DeepSeek 价格；把该模型价格加进 `PRICES` 表即可启用
- 悬停 tooltip 会显示实际参与计价的模型名、单价与峰谷时段

### 已知限制（估算口径）

1. 金额是**估算值**：峰谷时段、节假日为本地判定，可能与实际账单有细微出入
2. 峰谷判定依赖内置的**中国法定节假日表**（`CN_HOLIDAYS`）与**调休上班表**（`CN_MAKEUP_DAYS`，当前均为 2026 年）。跨年后若未更新，法定节假日当天会被按峰时**高估**（周末不受影响，仍然正确按谷时计算）
3. 会话中途切换模型时，历史 token 统一按**当前模型**价格计价（token 投影不带模型维度，无法分模型拆账）
4. **子代理（subagent）会话**的用量记在各自的会话里，不计入父会话的「本会话」金额
5. 余额接口按官方返回展示（含赠送额度），与扣费明细可能有分钟级延迟

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
| 余额明显不符 | 检查 `PRICES`、`MODEL_ALIASES` 是否与[官方价目](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)同步 |
| 徽章出现 `本会话 · xxx 无价目` | 该模型 id 不在价目表内，且不是 DeepSeek 的 flash / pro 系列（典型情况是切到了其他厂商模型）。把价格加进 `PRICES` 即可启用；这是**故意的**，避免用 DeepSeek 价格估算别家模型 |
| 节假日当天金额偏高 | `CN_HOLIDAYS`（中国法定节假日表）还是旧年份；官方每年公布新安排后更新该表即可（周末不受影响） |
| 点击徽章感觉「没反应」 | 数值本来就可能没变化（余额变动很小）；本版起点击会显示「余额 刷新中…」并强制绕过缓存，tooltip 里有「最后更新」时间可确认 |
| 点击完全没反应且不显示刷新中 | 说明点击被外层容器吞掉，把该现象反馈给维护者（需要调整挂载方式） |

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

## 维护与自测

官方调价或发布新模型后，只需要改 `lib/client.js` 顶部的三处配置，再重启 dsh：

| 改哪里 | 什么时候改 |
| --- | --- |
| `PRICES` | 官方调整单价（照抄[官方价目](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)的**人民币**列） |
| `MODEL_ALIASES` | 官方下线某个模型、给出兼容路由时（旧名 → 现役模型 id） |
| `CN_HOLIDAYS` | 每年国务院公布次年放假安排后（[中国政府网](https://www.gov.cn/)） |
| `CN_MAKEUP_DAYS` | 同上（放假日程里的「调休上班」日期，只为 tooltip 标注更准确，不影响金额） |

本地自测脚本放在工作区 `.debug/`（已 gitignore，不入库）：

```bash
node .debug/test-pricing.mjs   # 价目表 / 峰谷时段 / 节假日表 / 花费公式（直接对源码断言）
node .debug/test-render.mjs    # 徽章渲染与 tooltip（含 DSH 0.1.2+ 快照结构的回归用例）
```

---

## 版本历史

- v1（动态插件 `dsmon-1/pkg-1`）：会话级临时插件，进程重启即消失
- v1 持久化（包名 `dsh-money`）：位于 `~/.dsh/profiles/web/packages/dsh-money`，已废弃删除
- v1 重命名：包名改为 `deepseek-api-money`，源码迁移至本文件夹，profile 以符号链接指向这里
- v1.1：计价模型自动跟随当前选择的模型（`modelDirectories` → 节点 provenance → 兜底）
- v1.2：新增视觉模型 `deepseek-v4-flash-vision-exp` 价目（同 v4-flash，图片每张上限 384 token 计入输入）
- v1.2.1：适配 DSH 0.1.2+ 快照结构变化——聊天节点改经 `useChat` hook 读取（旧 `useSession().chat` 已废弃，会导致徽章渲染崩溃）
- v1.2.2：手动点击改为**强制刷新**（`?force=1` 跳过宿主 30 秒缓存），点击时显示「余额 刷新中…」，tooltip 增加「最后更新」时间
- v1.3.0：同步 **2026-09-10 官方新价目**
  - 价目改用官方**人民币**列：`deepseek-flash`（= V4.1-Flash，原生多模态）¥1 / ¥0.02 / ¥4，`deepseek-v4-pro` ¥4.5 / ¥0.15 / ¥13.5（计费不变）
  - 下线模型走 `MODEL_ALIASES`：`deepseek-v4-flash`、`deepseek-v4-flash-vision-exp` 与内部 beta 名按 Flash 价目计费，tooltip 注明「已由 deepseek-flash 承接」
  - 峰谷规则改为以**北京时间**判定：周一至周五（不含中国法定节假日）09:00–12:00、14:00–18:00 为峰时，其余（含周末、法定节假日全天）为谷时；内置 2026 年法定节假日表
  - 表外的 DeepSeek 新模型 / beta id 按名称推定价目；**其他厂商模型不再误用 DeepSeek 价格**（显示「无价目」）
  - 视觉模型图片计费口径更新：每张图上限 384 → **1024 token**，缩放目标约 1300×1300 等效像素
  - 新增本地自测脚本（价目 / 峰谷 / 渲染，共 96 项断言）
- v1.3.1（当前）：按 DeepSeek 平台公告细化峰谷判定——「**调休上班的周末**、中国法定节假日全天均按空闲时段计费」，新增 2026 年调休上班表 `CN_MAKEUP_DAYS`，tooltip 对调休日标注「谷时（调休上班日）」；自测增至 **110 项断言**
