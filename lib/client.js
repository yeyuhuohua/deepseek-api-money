window.__ModuleLoader__.load({
  id: "deepseek-api-money",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");

    // ---- 可调参数 ----
    var DEFAULT_MODEL = "deepseek-flash"; // 兜底计价模型（无法获知当前模型时使用）
    var CNY_PER_USD = 6.8;                // 仅用于 tooltip 里的美元参考换算（价目本身用官方人民币价目）
    var REFRESH_MS = 60000;               // 余额自动刷新间隔（毫秒）

    // 官方价目（元 / 百万 token，**谷价**；峰价为谷价 ×2）
    // 来源: https://api-docs.deepseek.com/zh-cn/quick_start/pricing
    // 2026-09-10 04:00 UTC（DeepSeek-V4.1-Flash 发布）起生效；官方同时公布美元价
    // （Flash $0.15/$0.003/$0.6、Pro $0.66/$0.022/$1.98），这里直接采用人民币价目，
    // 与余额和实际扣费口径一致，避免汇率换算误差。
    var PRICE_FLASH = { miss: 1, hit: 0.02, out: 4 }; // deepseek-flash = DeepSeek-V4.1-Flash，原生多模态
    var PRICES = {
      "deepseek-flash": PRICE_FLASH,
      // DeepSeek-V4-Pro-0813：官方继续提供服务，计费方式不变
      "deepseek-v4-pro": { miss: 4.5, hit: 0.15, out: 13.5 }
    };

    // 旧模型名 / 内部 beta 名 → 现役模型 id（官方仍接受这些名字，请求由现役模型承接）
    var MODEL_ALIASES = {
      "deepseek-v4-flash": "deepseek-flash",                 // V4-Flash 已下线，路由到 V4.1-Flash
      "deepseek-v4-flash-vision-exp": "deepseek-flash",      // 视觉实验版已下线，路由到 V4.1-Flash
      "deepseek-v4.1-flash-expires-on-0910": "deepseek-flash" // V4.1-Flash 内部 beta 名
    };
    var ALIAS_LOOKUP = {};
    for (var ak in MODEL_ALIASES) ALIAS_LOOKUP[ak.toLowerCase()] = MODEL_ALIASES[ak];

    // 未单列 id 的兜底：只对 DeepSeek 自家模型按名字推定价目（新模型 / 内部 beta id 很常见）
    // 其他厂商模型（如 gemini-2.5-flash）不含 "deepseek"，不会被误用 DeepSeek 价格
    var PRICE_FALLBACKS = [
      { re: /flash/, key: "deepseek-flash" },
      { re: /pro/, key: "deepseek-v4-pro" }
    ];

    function priceFor(model) {
      if (typeof model !== "string" || model === "") return null;
      if (PRICES[model] !== undefined) return { price: PRICES[model], key: model, alias: false, guessed: false };
      var id = model.toLowerCase();
      var aliasTarget = ALIAS_LOOKUP[id];
      if (aliasTarget !== undefined) return { price: PRICES[aliasTarget], key: aliasTarget, alias: true, guessed: false };
      if (id.indexOf("deepseek") < 0) return null;
      for (var i = 0; i < PRICE_FALLBACKS.length; i++) {
        if (PRICE_FALLBACKS[i].re.test(id)) {
          return { price: PRICES[PRICE_FALLBACKS[i].key], key: PRICE_FALLBACKS[i].key, alias: false, guessed: true };
        }
      }
      return null;
    }

    // ---- 峰谷时段（官方以北京时间为准）----
    // 峰时: 周一至周五（不含中国法定节假日）09:00-12:00、14:00-18:00
    // 谷时: 其余全部时间（含周末与法定节假日全天），价格为峰时的一半
    // 来源: https://api-docs.deepseek.com/zh-cn/quick_start/pricing
    var BJ_OFFSET_MS = 8 * 3600 * 1000;

    // 中国法定节假日（北京时间的放假日期；取自国办发明电〔2025〕7 号 → 2026 年安排）
    // 每年国务院公布新一年安排后请更新本表；表中没有的工作日按峰时计算（宁可略高估，不漏算）
    var CN_HOLIDAYS = [
      "2026-01-01", "2026-01-02", "2026-01-03",
      "2026-02-15", "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19",
      "2026-02-20", "2026-02-21", "2026-02-22", "2026-02-23",
      "2026-04-04", "2026-04-05", "2026-04-06",
      "2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05",
      "2026-06-19", "2026-06-20", "2026-06-21",
      "2026-09-25", "2026-09-26", "2026-09-27",
      "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04",
      "2026-10-05", "2026-10-06", "2026-10-07"
    ];
    var CN_HOLIDAY_SET = {};
    for (var hi = 0; hi < CN_HOLIDAYS.length; hi++) CN_HOLIDAY_SET[CN_HOLIDAYS[hi]] = true;

    function pad2(n) { return n < 10 ? "0" + n : String(n); }

    // 把时间戳平移到北京时间，再用 getUTC* 读取，得到的就是北京时间字段
    function beijing(date) { return new Date(date.getTime() + BJ_OFFSET_MS); }

    function bjDateKey(date) {
      var bj = beijing(date);
      return bj.getUTCFullYear() + "-" + pad2(bj.getUTCMonth() + 1) + "-" + pad2(bj.getUTCDate());
    }

    // "peak" | "weekend" | "holiday" | "offpeak"
    function periodOf(date) {
      var bj = beijing(date);
      var dow = bj.getUTCDay(); // 0=周日 6=周六
      var h = bj.getUTCHours();
      if (CN_HOLIDAY_SET[bjDateKey(date)] === true) return "holiday";
      if (dow === 0 || dow === 6) return "weekend";
      return (h >= 9 && h < 12) || (h >= 14 && h < 18) ? "peak" : "offpeak";
    }

    function peakFactor(date) { return periodOf(date) === "peak" ? 2 : 1; }

    var PERIOD_LABEL = { peak: "峰时 ×2", weekend: "谷时（周末）", holiday: "谷时（法定节假日）", offpeak: "谷时" };

    function fmtTokens(n) {
      if (n < 1e3) return String(n);
      if (n < 1e6) {
        var v = n / 1e3;
        return String(v >= 100 ? Math.round(v) : Math.round(v * 10) / 10) + "K";
      }
      var v2 = n / 1e6;
      return String(v2 >= 100 ? Math.round(v2) : Math.round(v2 * 10) / 10) + "M";
    }

    function fmtCNY(v) {
      if (v >= 1) return v.toFixed(2);
      if (v >= 0.001) return v.toFixed(3);
      // 新价目下小额会话可能低于 0.001 元：多留一位，避免显示成假的 ¥0.000
      return v > 0 ? v.toFixed(4) : "0.000";
    }

    // 最近一轮 assistant 节点实际使用的模型（provenance / requestConfig）
    function modelFromNodes(nodes) {
      if (!Array.isArray(nodes)) return undefined;
      for (var i = nodes.length - 1; i >= 0; i--) {
        var node = nodes[i];
        if (node === null || node === undefined || node.kind !== "assistant") continue;
        if (node.provenance !== undefined && node.provenance !== null && typeof node.provenance.model === "string" && node.provenance.model !== "") {
          return node.provenance.model;
        }
        if (node.requestConfig !== undefined && node.requestConfig !== null && typeof node.requestConfig.model === "string" && node.requestConfig.model !== "") {
          return node.requestConfig.model;
        }
      }
      return undefined;
    }

    // 计价模型解析顺序:
    // 1. 模型选择器当前选中的模型（切换后立即生效，经 ctx.modelDirectories 共享目录）
    // 2. 最近一轮实际使用的模型（节点 provenance）
    // 3. DEFAULT_MODEL 兜底
    function currentModel(ctx, sessionId, nodes) {
      var modelDirectories = ctx.get("modelDirectories");
      if (modelDirectories !== undefined && modelDirectories !== null && typeof modelDirectories.directoryFor === "function" && sessionId !== undefined && sessionId !== null) {
        try {
          var dir = modelDirectories.directoryFor(sessionId);
          if (dir !== null && dir !== undefined && dir.store !== undefined && typeof dir.store.getSnapshot === "function") {
            var snap = dir.store.getSnapshot();
            var cur = snap !== null && snap !== undefined ? snap.current : null;
            if (cur !== null && cur !== undefined && typeof cur.model === "string" && cur.model !== "") return cur.model;
          }
        } catch (e) { /* 目录不可用时回退到节点/兜底 */ }
      }
      var fromNodes = modelFromNodes(nodes);
      if (fromNodes !== undefined) return fromNodes;
      return DEFAULT_MODEL;
    }

    // 会话花费估算: 未缓存输入/缓存写按 miss 价, 缓存读按 hit 价, 输出按 out 价
    function costOf(usage, date, model) {
      if (usage === undefined || usage === null) return null;
      var found = priceFor(model);
      if (found === null) return { unknown: true, model: model };
      var p = found.price;
      var factor = peakFactor(date);
      var uncached = Number(usage.uncachedInputTokens) || 0;
      var cacheRead = Number(usage.cacheReadTokens) || 0;
      var cacheWrite = Number(usage.cacheWriteTokens) || 0;
      var output = Number(usage.outputTokens) || 0;
      var input = uncached + cacheRead + cacheWrite;
      var cny = (uncached * p.miss + cacheWrite * p.miss + cacheRead * p.hit + output * p.out) / 1e6 * factor;
      return {
        cny: cny, usd: cny / CNY_PER_USD, factor: factor, period: periodOf(date),
        priceKey: found.key, alias: found.alias, guessed: found.guessed, price: p,
        input: input, output: output, cacheRead: cacheRead, model: model
      };
    }

    var CSS = ".dsMoney_root{box-sizing:border-box;width:100%;max-width:var(--dsh-chat-content-width);margin:0 auto;padding:2px calc(var(--dsh-composer-side-clearance) + 16px) 0;color:var(--dsw-alias-label-tertiary);text-align:center;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;font-size:12px;line-height:20px;cursor:pointer;display:block}.dsMoney_root:hover{color:var(--dsw-alias-label-secondary)}.dsMoney_sep{color:var(--dsw-alias-separator-primary);margin:0 10px}";

    function Readout(props) {
      var ctx = props.ctx;
      var useProjection = props.useProjection;
      var useChat = props.useChat;
      var sessionId = props.sessionId;
      var statusPair = React.useState({ kind: "loading" });
      var status = statusPair[0];
      var setStatus = statusPair[1];
      var nowPair = React.useState(new Date());
      var now = nowPair[0];
      var setNow = nowPair[1];
      // 手动刷新中（点击徽章时置位，用来给用户视觉反馈）
      var busyPair = React.useState(false);
      var busy = busyPair[0];
      var setBusy = busyPair[1];
      var updatedPair = React.useState(null);
      var updated = updatedPair[0];
      var setUpdated = updatedPair[1];
      var refresh = React.useCallback(function (force) {
        if (force === true) setBusy(true);
        var url = "/deepseek-api-money/status" + (force === true ? "?force=1" : "");
        fetch(url, { cache: "no-store" }).then(function (r) {
          return r.json();
        }).then(function (res) {
          if (res !== null && typeof res === "object" && res.kind === "ok") {
            setStatus(res);
            setUpdated(new Date());
          } else {
            setStatus({ kind: "error", message: res !== null && typeof res === "object" && res.message !== undefined ? String(res.message) : "未知错误" });
          }
        }).catch(function (err) {
          setStatus({ kind: "error", message: String(err !== undefined && err.message !== undefined ? err.message : err) });
        }).then(function () {
          setBusy(false);
        });
      }, []);
      React.useEffect(function () {
        refresh(false);
        var stopNow = ctx.interval(function () { setNow(new Date()); }, 30000);
        var stopRefresh = ctx.interval(function () { refresh(false); }, REFRESH_MS);
        return function () { stopNow(); stopRefresh(); };
      }, [refresh]);

      // 订阅共享模型目录：切换模型后徽章立即重算
      var directory = null;
      var modelDirectories = ctx.get("modelDirectories");
      if (modelDirectories !== undefined && modelDirectories !== null && typeof modelDirectories.directoryFor === "function" && sessionId !== undefined && sessionId !== null) {
        try { directory = modelDirectories.directoryFor(sessionId); } catch (e) { directory = null; }
      }
      var subscribeModel = React.useMemo(function () {
        return function (fn) {
          if (directory === null || directory.store === undefined) return function () {};
          return directory.store.subscribe(fn);
        };
      }, [directory]);
      var getModelSnapshot = React.useMemo(function () {
        return function () {
          return directory === null || directory.store === undefined ? null : directory.store.getSnapshot();
        };
      }, [directory]);
      React.useSyncExternalStore(subscribeModel, getModelSnapshot, getModelSnapshot);

      // 0.1.2+ 拆分了 chat 快照：改用 useChat hook（同新版 StatsLine）
      var nodes = typeof useChat === "function" ? useChat(function (s) {
        return s !== null && s !== undefined && s.legacy !== undefined && s.legacy !== null ? s.legacy.nodes : undefined;
      }) : undefined;
      var model = currentModel(ctx, sessionId, nodes);
      var usage = typeof useProjection === "function" ? useProjection("tokenUsage") : undefined;
      var cost = costOf(usage, now, model);

      var parts = [];
      var tip = [];
      if (busy === true) {
        parts.push("余额 刷新中…");
        tip.push("正在查询 DeepSeek 余额接口（强制刷新，跳过缓存）");
      } else if (status.kind === "ok") {
        parts.push("余额 " + status.currency + status.total);
        tip.push("DeepSeek API 余额: " + status.currency + status.total + "（充值 " + status.currency + status.topped + " · 赠送 " + status.currency + status.granted + "）");
      } else if (status.kind === "error") {
        parts.push("余额获取失败 · 点击重试");
        tip.push("余额获取失败: " + status.message);
      } else {
        parts.push("余额 …");
      }
      if (cost !== null) {
        if (cost.unknown === true) {
          parts.push("本会话 · " + cost.model + " 无价目");
          tip.push("当前模型 " + cost.model + " 不在价目表中，未估算金额（价目见 PRICES）");
        } else {
          parts.push("本会话 ≈¥" + fmtCNY(cost.cny));
          tip.push("本会话: 输入 " + fmtTokens(cost.input) + " · 缓存读 " + fmtTokens(cost.cacheRead) + " · 输出 " + fmtTokens(cost.output));
          tip.push("估算花费: ¥" + fmtCNY(cost.cny) + "（" + cost.model + " · " + PERIOD_LABEL[cost.period] + "）");
          tip.push("单价: 输入 ¥" + cost.price.miss + " · 缓存读 ¥" + cost.price.hit + " · 输出 ¥" + cost.price.out + " / 百万 token（谷价）");
          tip.push("美元参考: $" + cost.usd.toFixed(4) + "（按 1 USD = " + CNY_PER_USD + " CNY 换算）");
          if (cost.alias === true) tip.push("价目: " + cost.model + " 已由 " + cost.priceKey + " 承接，按同一价目计费");
          else if (cost.guessed === true) tip.push("价目: 该模型 id 未单列，按 " + cost.priceKey + " 价目估算");
        }
      }
      if (updated !== null && updated !== undefined) {
        tip.push("最后更新: " + updated.toLocaleTimeString());
      }
      tip.push("点击立即刷新余额（强制查官方接口，每 " + Math.round(REFRESH_MS / 1000) + " 秒自动刷新）");

      var children = [];
      parts.forEach(function (text, i) {
        if (i > 0) children.push(React.createElement("span", { key: "s" + i, className: "dsMoney_sep", "aria-hidden": true }, "·"));
        children.push(React.createElement("span", { key: "p" + i }, text));
      });
      return React.createElement("div", {
        className: "dsMoney_root",
        title: tip.join("\n"),
        role: "button",
        tabIndex: 0,
        onClick: function () { refresh(true); },
        onKeyDown: function (e) { if (e.key === "Enter" || e.key === " ") refresh(true); }
      }, children);
    }

    var inject = ["slots", "timer"];
    function apply(ctx) {
      var slots = ctx.slots;
      if (slots === undefined) return;
      var style = document.createElement("style");
      style.textContent = CSS;
      document.head.appendChild(style);
      ctx.effect(() => () => style.remove(), "deepseek-api-money: badge styles");
      slots.inject("conversation.composer.dock", () => slots.register(
        { name: "conversation.composer.dock", id: "deepseek-api-money", order: 1, label: "DeepSeek API 余额" },
        (props) => React.createElement(Readout, {
          ctx: ctx,
          useProjection: props !== undefined && props !== null ? props.useProjection : undefined,
          useChat: props !== undefined && props !== null ? props.useChat : undefined,
          sessionId: props !== undefined && props !== null ? props.sessionId : undefined
        })
      ));
    }
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
