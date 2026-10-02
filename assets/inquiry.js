/* ============================================================
   在线登记 —— 界面逻辑
   依赖：assets/cloud.js（SDK 初始化与数据访问）
   约定：模型输出一律用 textContent 渲染，绝不拼进 innerHTML
   ============================================================ */

(function () {
  "use strict";

  var el = {};
  var precheckText = "";
  var lastPrecheckAt = 0;
  var precheckCount = 0;
  var PRECHECK_COOLDOWN_MS = 15000;
  var PRECHECK_MAX = 3;
  var COOLDOWN_TIMER = null;

  function $(id) { return document.getElementById(id); }

  function setMsg(text, kind) {
    if (!el.msg) return;
    el.msg.textContent = text || "";
    el.msg.className = "fmsg" + (kind ? " fmsg-" + kind : "");
  }

  function fields() {
    return {
      company: clean(el.company.value, 100),
      industry: clean(el.industry.value, 30),
      scene: clean(el.scene.value, 30),
      contact: clean(el.contact.value, 40),
      contactNo: clean(el.contactNo.value, 60),
      note: clean(el.note.value, 500)
    };
  }

  function lock(locked) {
    el.submit.disabled = locked;
    el.company.disabled = locked;
    el.industry.disabled = locked;
    el.scene.disabled = locked;
    el.contact.disabled = locked;
    el.contactNo.disabled = locked;
    el.note.disabled = locked;
    el.precheck.disabled = locked;
  }

  /* ---------------- 预检 ---------------- */

  function startCooldown() {
    var btn = el.precheck;
    var left = Math.ceil(PRECHECK_COOLDOWN_MS / 1000);
    btn.disabled = true;
    btn.textContent = "请 " + left + " 秒后重试";
    COOLDOWN_TIMER = setInterval(function () {
      left -= 1;
      if (left <= 0) {
        clearInterval(COOLDOWN_TIMER);
        COOLDOWN_TIMER = null;
        btn.disabled = false;
        btn.textContent = "生成智能预检方案";
        return;
      }
      btn.textContent = "请 " + left + " 秒后重试";
    }, 1000);
  }

  async function onPrecheck() {
    if (!cloud) {
      setMsg("云服务未就绪，无法生成预检方案。可直接提交登记。", "err");
      return;
    }
    var f = fields();
    if (!f.company) {
      setMsg("请先填写待核查企业名称。", "err");
      el.company.focus();
      return;
    }
    if (precheckCount >= PRECHECK_MAX) {
      setMsg("预检次数已达上限，请直接提交登记，人工受理时会补齐核查方案。", "info");
      return;
    }

    precheckCount += 1;
    lastPrecheckAt = Date.now();
    startCooldown();

    el.empty.hidden = true;
    el.out.hidden = false;
    el.out.classList.add("is-typing");
    el.out.textContent = "";
    el.meta.hidden = true;
    setMsg("正在生成预检方案…", "info");

    var t0 = Date.now();
    try {
      precheckText = await runPrecheck(f.company, f.industry, f.scene, function (delta) {
        /* delta 为 null 表示切换候选模型，清空重来 */
        if (delta === null) { el.out.textContent = ""; return; }
        el.out.textContent += delta;
        el.out.scrollTop = el.out.scrollHeight;
      });
      el.out.classList.remove("is-typing");
      if (!precheckText.trim()) {
        el.out.hidden = true;
        el.empty.hidden = false;
        setMsg("模型未返回内容，可直接提交登记。", "info");
        return;
      }
      el.meta.hidden = false;
      el.meta.textContent = "耗时 " + ((Date.now() - t0) / 1000).toFixed(1) + "s　·　" + precheckText.length + " 字　·　仅供参考，不构成结论";
      setMsg("预检方案已生成，可随登记一并提交。", "ok");
    } catch (e) {
      el.out.classList.remove("is-typing");
      if (!el.out.textContent) {
        el.out.hidden = true;
        el.empty.hidden = false;
      }
      setMsg(llmErrorText(e), "err");
    }
  }

  /* ---------------- 提交 ---------------- */

  async function onSubmit(ev) {
    ev.preventDefault();
    if (!cloud) {
      setMsg("云服务未就绪，暂时无法提交。请稍后刷新页面重试。", "err");
      return;
    }
    var f = fields();
    if (!f.company) { setMsg("请填写待核查企业名称。", "err"); el.company.focus(); return; }
    if (!f.contact) { setMsg("请填写联系人。", "err"); el.contact.focus(); return; }
    if (!f.contactNo) { setMsg("请填写联系方式。", "err"); el.contactNo.focus(); return; }

    var ticket = makeTicket();
    setMsg("正在提交…", "info");
    el.submit.disabled = true;

    try {
      var res = await submitInquiry({
        ticket: ticket,
        company: f.company,
        industry: f.industry,
        scene: f.scene,
        contact: f.contact,
        contact_no: f.contactNo,
        note: f.note,
        precheck: clean(precheckText, 4000) || null
      });
      if (res.error) {
        setMsg(dbErrorText(res.error), "err");
        el.submit.disabled = false;
        return;
      }
      lock(true);
      setMsg(
        "已受理 · 受理编号 " + res.data.ticket + " · 数据已写入云端并回读校验通过（记录 #" +
        res.data.id + "）。我们会在一个工作日内与您联系确认核查范围。",
        "ok"
      );
    } catch (e) {
      setMsg(dbErrorText(e), "err");
      el.submit.disabled = false;
    }
  }

  /* ---------------- 启动 ---------------- */

  function boot() {
    el = {
      form: $("inq-form"),
      company: $("f-company"),
      industry: $("f-industry"),
      scene: $("f-scene"),
      contact: $("f-contact"),
      contactNo: $("f-contactno"),
      note: $("f-note"),
      msg: $("f-msg"),
      precheck: $("btn-precheck"),
      submit: $("btn-submit"),
      out: $("pcp-out"),
      empty: $("pcp-empty"),
      meta: $("pcp-meta")
    };
    if (!el.form) return;

    if (!initCloud()) {
      el.precheck.disabled = true;
      el.submit.disabled = true;
      setMsg("云服务 SDK 未能加载，在线登记暂不可用。请检查网络后刷新页面。", "err");
      return;
    }

    el.precheck.addEventListener("click", onPrecheck);
    el.form.addEventListener("submit", onSubmit);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
