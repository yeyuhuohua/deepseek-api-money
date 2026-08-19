window.__ModuleLoader__.load({
  id: "deepseek-api-money",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");

    // ---- 可调参数 ----
    var DEFAULT_MODEL = "deepseek-v4-pro"; // 兜底计价模型（无法获知当前模型时使用）
    var CNY_PER_USD = 7.2;                 // USD->CNY 汇率（官方价目为 USD，余额接口返回 CNY）
    var REFRESH_MS = 60000;                // 余额自动刷新间隔（毫秒）

    // 官方价目（美元/百万 token，谷价；峰价为 2 倍）
    // 来源: https://api-docs.deepseek.com/quick_start/pricing
    var PRICES = {
      "deepseek-v4-flash": { miss: 0.22, hit: 0.007, out: 0.66 },
      "deepseek-v4-pro": { miss: 0.66, hit: 0.022, out: 1.98 }
    };

    // 峰时: UTC 01:00-04:00 与 06:00-10:00，其余为谷时（半价）
    function peakFactor(date) {
      var h = date.getUTCHours();
      return (h >= 1 && h < 4) || (h >= 6 && h < 10) ? 2 : 1;
    }

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
      return v >= 1 ? v.toFixed(2) : v.toFixed(3);
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
      var p = PRICES[model];
      if (p === undefined) return { unknown: true, model: model };
      var factor = peakFactor(date);
      var uncached = Number(usage.uncachedInputTokens) || 0;
      var cacheRead = Number(usage.cacheReadTokens) || 0;
      var cacheWrite = Number(usage.cacheWriteTokens) || 0;
      var output = Number(usage.outputTokens) || 0;
      var input = uncached + cacheRead + cacheWrite;
      var usd = (uncached * p.miss + cacheWrite * p.miss + cacheRead * p.hit + output * p.out) / 1e6 * factor;
      return { usd: usd, cny: usd * CNY_PER_USD, factor: factor, input: input, output: output, cacheRead: cacheRead, model: model };
    }

    var CSS = ".dsMoney_root{box-sizing:border-box;width:100%;max-width:var(--dsh-chat-content-width);margin:0 auto;padding:2px calc(var(--dsh-composer-side-clearance) + 16px) 0;color:var(--dsw-alias-label-tertiary);text-align:center;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;font-size:12px;line-height:20px;cursor:pointer;display:block}.dsMoney_root:hover{color:var(--dsw-alias-label-secondary)}.dsMoney_sep{color:var(--dsw-alias-separator-primary);margin:0 10px}";

    function Readout(props) {
      var ctx = props.ctx;
      var useProjection = props.useProjection;
      var useSession = props.useSession;
      var sessionId = props.sessionId;
      var statusPair = React.useState({ kind: "loading" });
      var status = statusPair[0];
      var setStatus = statusPair[1];
      var nowPair = React.useState(new Date());
      var now = nowPair[0];
      var setNow = nowPair[1];
      var refresh = React.useCallback(function () {
        fetch("/deepseek-api-money/status", { cache: "no-store" }).then(function (r) {
          return r.json();
        }).then(function (res) {
          if (res !== null && typeof res === "object" && res.kind === "ok") setStatus(res);
          else setStatus({ kind: "error", message: res !== null && typeof res === "object" && res.message !== undefined ? String(res.message) : "未知错误" });
        }).catch(function (err) {
          setStatus({ kind: "error", message: String(err !== undefined && err.message !== undefined ? err.message : err) });
        });
      }, []);
      React.useEffect(function () {
        refresh();
        var stopNow = ctx.interval(function () { setNow(new Date()); }, 30000);
        var stopRefresh = ctx.interval(refresh, REFRESH_MS);
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

      var nodes = typeof useSession === "function" ? useSession(function (s) { return s.chat.legacy.nodes; }) : undefined;
      var model = currentModel(ctx, sessionId, nodes);
      var usage = typeof useProjection === "function" ? useProjection("tokenUsage") : undefined;
      var cost = costOf(usage, now, model);

      var parts = [];
      var tip = [];
      if (status.kind === "ok") {
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
          tip.push("估算花费: $" + cost.usd.toFixed(4) + " ≈ ¥" + fmtCNY(cost.cny) + "（" + cost.model + " · " + (cost.factor === 2 ? "峰时 ×2" : "谷时") + "）");
        }
      }
      tip.push("点击立即刷新余额（每 " + Math.round(REFRESH_MS / 1000) + " 秒自动刷新）");

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
        onClick: refresh,
        onKeyDown: function (e) { if (e.key === "Enter" || e.key === " ") refresh(); }
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
          useSession: props !== undefined && props !== null ? props.useSession : undefined,
          sessionId: props !== undefined && props !== null ? props.sessionId : undefined
        })
      ));
    }
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
