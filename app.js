(() => {
  const STORAGE_KEY = "huaneng_anqui_quiz_v7";
  const MODE_LABEL = {
    seq: "顺序练习",
    rand: "随机练习",
    wrong: "错题重练",
    exam: "模拟小测",
  };
  const TYPE_LABEL = {
    blank: "填空题",
    single: "单项选择",
    multi: "多项选择",
    judge: "判断题",
    short: "简答题",
  };

  const state = {
    mode: "seq",
    chapter: "all",
    section: "all",
    qtype: "all",
    queue: [],
    index: 0,
    correct: 0,
    wrong: 0,
    revealed: 0,
    answered: false,
    sessionWrongIds: [],
    store: loadStore(),
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  function loadStore() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultStore();
    } catch {
      return defaultStore();
    }
  }

  function defaultStore() {
    return { wrongIds: [], tried: {}, history: { ok: 0, bad: 0 } };
  }

  function saveStore() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.store));
  }

  function normalize(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[，,]/g, "；")
      .replace(/[（(]/g, "(")
      .replace(/[）)]/g, ")")
      .replace(/[：:]/g, ":")
      .replace(/℃/g, "°c")
      .replace(/°c/g, "℃")
      .replace(/km\/h/gi, "km/h")
      .replace(/ｍ/g, "m")
      .replace(/ｍｍ/g, "mm")
      .replace(/正确|是|√|v|true/gi, "对")
      .replace(/错误|否|×|x|false/gi, "错");
  }

  function splitAnswer(ans) {
    return String(ans)
      .split(/[；;]/)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  function qType(q) {
    return q.type || "blank";
  }

  function checkBlankAnswers(userParts, standard) {
    const stdParts = splitAnswer(standard);
    const joinedUser = normalize(userParts.join("；"));
    const joinedStd = normalize(stdParts.join("；"));
    if (joinedUser === joinedStd) return { ok: true, detail: stdParts.map(() => true) };

    const altMap = {
      三同时: "同时设计；同时施工；同时投入生产和使用",
    };
    for (const [k, v] of Object.entries(altMap)) {
      if (joinedUser.includes(normalize(k)) && normalize(v) === joinedStd) {
        return { ok: true, detail: stdParts.map(() => true) };
      }
    }

    if (userParts.length === stdParts.length) {
      const detail = userParts.map((u, i) => normalize(u) === normalize(stdParts[i]));
      return { ok: detail.every(Boolean), detail };
    }

    if (userParts.length === 1 && stdParts.length > 1) {
      const parts = splitAnswer(userParts[0]);
      if (parts.length === stdParts.length) {
        const detail = parts.map((u, i) => normalize(u) === normalize(stdParts[i]));
        return { ok: detail.every(Boolean), detail };
      }
    }

    return { ok: false, detail: stdParts.map(() => false) };
  }

  function checkShortAnswer(userText, q) {
    const text = normalize(userText);
    if (!text) return { ok: false, hit: 0, need: 0 };
    const keys = (q.keywords || splitAnswer(q.answer)).map(normalize).filter(Boolean);
    if (!keys.length) {
      return { ok: normalize(userText) === normalize(q.answer), hit: 0, need: 0 };
    }
    const hit = keys.filter((k) => text.includes(k)).length;
    const need = Math.max(2, Math.ceil(keys.length * 0.5));
    return { ok: hit >= need, hit, need, total: keys.length };
  }

  function allQuestions() {
    const blanks = (window.QUIZ_QUESTIONS || []).map((q) =>
      q.type ? q : { ...q, type: "blank" }
    );
    const extra = window.QUIZ_EXTRA || [];
    return blanks.concat(extra);
  }

  function filteredPool() {
    let pool = allQuestions();
    if (state.chapter !== "all") {
      pool = pool.filter((q) => q.chapter === state.chapter);
    }
    if (state.section !== "all") {
      pool = pool.filter((q) => q.section === state.section);
    }
    if (state.qtype !== "all") {
      pool = pool.filter((q) => qType(q) === state.qtype);
    }
    return pool;
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function buildQueue(mode) {
    let pool = filteredPool();
    if (mode === "wrong") {
      const set = new Set(state.store.wrongIds);
      pool = pool.filter((q) => set.has(q.id));
    }
    if (!pool.length) return [];
    if (mode === "rand") return shuffle(pool);
    if (mode === "exam") {
      // 模拟卷：尽量混合题型
      const byType = { blank: [], single: [], multi: [], judge: [], short: [] };
      pool.forEach((q) => {
        const t = qType(q);
        if (byType[t]) byType[t].push(q);
      });
      Object.keys(byType).forEach((k) => {
        byType[k] = shuffle(byType[k]);
      });
      const pick = [];
      const plan = [
        ["blank", 10],
        ["single", 8],
        ["multi", 5],
        ["judge", 5],
        ["short", 4],
      ];
      plan.forEach(([t, n]) => {
        pick.push(...byType[t].slice(0, n));
      });
      if (pick.length < 20) {
        const rest = shuffle(pool.filter((q) => !pick.includes(q)));
        pick.push(...rest.slice(0, 30 - pick.length));
      }
      return shuffle(pick).slice(0, Math.min(30, pick.length || pool.length));
    }
    // seq: blanks first by id, then extras by id
    return pool.slice().sort((a, b) => a.id - b.id);
  }

  function showView(id) {
    $$(".view").forEach((v) => v.classList.remove("active"));
    $(id).classList.add("active");
  }

  function updateHomeStats() {
    const qs = allQuestions();
    $("#stat-total").textContent = qs.length;
    const tried = Object.keys(state.store.tried || {}).length;
    $("#stat-done").textContent = tried;
    $("#stat-wrong").textContent = (state.store.wrongIds || []).length;
    const { ok, bad } = state.store.history || { ok: 0, bad: 0 };
    const total = ok + bad;
    $("#stat-acc").textContent = total ? Math.round((ok / total) * 100) + "%" : "—";
  }

  function renderSectionChips() {
    const box = $("#section-chips");
    let pool = allQuestions();
    if (state.chapter !== "all") pool = pool.filter((q) => q.chapter === state.chapter);
    if (state.qtype !== "all") pool = pool.filter((q) => qType(q) === state.qtype);
    const sections = [...new Set(pool.map((q) => q.section))];
    box.innerHTML =
      `<button type="button" class="chip ${state.section === "all" ? "active" : ""}" data-sec="all">全部小节</button>` +
      sections
        .map(
          (s) =>
            `<button type="button" class="chip ${state.section === s ? "active" : ""}" data-sec="${s}">${s}</button>`
        )
        .join("");
    box.querySelectorAll(".chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.section = btn.dataset.sec;
        renderSectionChips();
      });
    });
  }

  function startMode(mode) {
    state.mode = mode;
    state.queue = buildQueue(mode);
    if (!state.queue.length) {
      alert(
        mode === "wrong"
          ? "暂无错题。先去做几道题吧！"
          : "当前筛选范围内没有题目，请调整范围或题型。"
      );
      return;
    }
    state.index = 0;
    state.correct = 0;
    state.wrong = 0;
    state.revealed = 0;
    state.sessionWrongIds = [];
    showView("#view-quiz");
    renderQuestion();
  }

  function currentQ() {
    return state.queue[state.index];
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function letterOf(opt) {
    const m = String(opt).match(/^([A-D])\s*[\.、．]/);
    return m ? m[1] : "";
  }

  function updateHint(type) {
    const hints = {
      blank: "提示：在题干空白处直接填写；数字、单位尽量与原文一致。",
      single: "提示：单项选择题，点击一个选项后提交。",
      multi: "提示：多项选择题，可选多个选项，答案须全部选对。",
      judge: "提示：判断题，选择「对」或「错」。",
      short: "提示：简答题按要点作答，系统按关键词判分（不必逐字相同）。",
    };
    const el = $("#quiz-hint");
    if (el) el.textContent = hints[type] || hints.blank;
  }

  function enableInputsOnTap(nodes) {
    nodes.forEach((el) => {
      const unlock = () => {
        if (!el.hasAttribute("readonly")) return;
        el.removeAttribute("readonly");
        // 仅在用户手势后聚焦，才会弹键盘
        requestAnimationFrame(() => el.focus());
      };
      el.addEventListener("pointerdown", unlock, { once: true });
      el.addEventListener("touchstart", unlock, { once: true, passive: true });
      el.addEventListener("click", unlock, { once: true });
    });
  }

  function renderQuestion() {
    const q = currentQ();
    const type = qType(q);
    state.answered = false;

    const secLabel = q.variant ? `${q.section} · 变式${q.variant}` : q.section;
    $("#q-section").textContent = `${TYPE_LABEL[type] || type} · ${secLabel}`;
    $("#q-mode").textContent = MODE_LABEL[state.mode] || state.mode;
    $("#progress-text").textContent = `${state.index + 1} / ${state.queue.length}`;
    $("#progress-fill").style.width = `${((state.index + 1) / state.queue.length) * 100}%`;
    $("#live-score").textContent = `${state.correct} 对 / ${state.wrong} 错`;

    const body = $("#q-body");
    body.innerHTML = "";

    if (type === "blank") {
      const parts = q.question.split("____");
      let html = "";
      parts.forEach((p, i) => {
        html += escapeHtml(p);
        if (i < parts.length - 1) {
          // readonly：阻止 iOS/安卓进题时自动聚焦并弹键盘；用户点按后再解锁
          html += `<input type="text" class="blank-input" readonly autocomplete="off" spellcheck="false" inputmode="text" data-i="${i}" placeholder="（${i + 1}）" aria-label="空${i + 1}" />`;
        }
      });
      body.innerHTML = `<h2 class="q-text">${html}</h2>`;
      enableInputsOnTap(body.querySelectorAll("input.blank-input"));
    } else if (type === "single" || type === "multi") {
      const multi = type === "multi";
      body.innerHTML =
        `<h2 class="q-text">${escapeHtml(q.question)}</h2>` +
        `<div class="option-list" data-multi="${multi ? "1" : "0"}">` +
        (q.options || [])
          .map((opt, i) => {
            const letter = letterOf(opt) || String.fromCharCode(65 + i);
            return `<button type="button" class="option-btn" data-letter="${letter}"><span class="opt-key">${letter}</span><span class="opt-text">${escapeHtml(opt.replace(/^[A-D]\s*[\.、．]\s*/, ""))}</span></button>`;
          })
          .join("") +
        `</div>`;
      body.querySelectorAll(".option-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (state.answered) return;
          if (multi) btn.classList.toggle("selected");
          else {
            body.querySelectorAll(".option-btn").forEach((b) => b.classList.remove("selected"));
            btn.classList.add("selected");
          }
        });
      });
    } else if (type === "judge") {
      body.innerHTML =
        `<h2 class="q-text">${escapeHtml(q.question)}</h2>` +
        `<div class="judge-row">` +
        `<button type="button" class="judge-btn" data-val="对">对</button>` +
        `<button type="button" class="judge-btn" data-val="错">错</button>` +
        `</div>`;
      body.querySelectorAll(".judge-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (state.answered) return;
          body.querySelectorAll(".judge-btn").forEach((b) => b.classList.remove("selected"));
          btn.classList.add("selected");
        });
      });
    } else if (type === "short") {
      body.innerHTML =
        `<h2 class="q-text">${escapeHtml(q.question)}</h2>` +
        `<textarea class="short-input" rows="5" readonly placeholder="点此处作答…" inputmode="text"></textarea>`;
      enableInputsOnTap(body.querySelectorAll("textarea.short-input"));
    }

    updateHint(type);
    $("#q-feedback").hidden = true;
    $("#q-answer").hidden = true;
    $("#btn-check").hidden = false;
    $("#btn-show").hidden = false;
    $("#btn-next").hidden = true;
  }

  function getChoiceLetters() {
    return $$("#q-body .option-btn.selected").map((b) => b.dataset.letter).sort().join("");
  }

  function getJudgeValue() {
    const btn = $("#q-body .judge-btn.selected");
    return btn ? btn.dataset.val : "";
  }

  function getUserResult(q) {
    const type = qType(q);
    if (type === "blank") {
      const parts = $$("#q-body input.blank-input").map((el) => el.value);
      if (parts.every((p) => !String(p).trim())) return { empty: true };
      return checkBlankAnswers(parts, q.answer);
    }
    if (type === "single" || type === "multi") {
      const got = getChoiceLetters();
      if (!got) return { empty: true };
      const std = String(q.answer || "")
        .toUpperCase()
        .replace(/[^A-D]/g, "")
        .split("")
        .sort()
        .join("");
      return { ok: got === std, got, std };
    }
    if (type === "judge") {
      const got = getJudgeValue();
      if (!got) return { empty: true };
      return { ok: normalize(got) === normalize(q.answer), got };
    }
    if (type === "short") {
      const ta = $("#q-body .short-input");
      const text = ta ? ta.value : "";
      if (!String(text).trim()) return { empty: true };
      return checkShortAnswer(text, q);
    }
    return { ok: false };
  }

  function lockInputs(q, result) {
    const type = qType(q);
    if (type === "blank") {
      $$("#q-body input.blank-input").forEach((el, i) => {
        el.disabled = true;
        el.classList.remove("ok", "bad");
        if (result.detail) {
          if (result.detail[i] === true) el.classList.add("ok");
          else if (result.detail[i] === false) el.classList.add("bad");
          else el.classList.add(result.ok ? "ok" : "bad");
        } else el.classList.add(result.ok ? "ok" : "bad");
      });
    } else if (type === "single" || type === "multi") {
      const std = String(q.answer || "")
        .toUpperCase()
        .replace(/[^A-D]/g, "");
      $$("#q-body .option-btn").forEach((btn) => {
        btn.disabled = true;
        const L = btn.dataset.letter;
        if (std.includes(L)) btn.classList.add("ok");
        if (btn.classList.contains("selected") && !std.includes(L)) btn.classList.add("bad");
      });
    } else if (type === "judge") {
      $$("#q-body .judge-btn").forEach((btn) => {
        btn.disabled = true;
        if (normalize(btn.dataset.val) === normalize(q.answer)) btn.classList.add("ok");
        if (btn.classList.contains("selected") && normalize(btn.dataset.val) !== normalize(q.answer)) {
          btn.classList.add("bad");
        }
      });
    } else if (type === "short") {
      const ta = $("#q-body .short-input");
      if (ta) {
        ta.disabled = true;
        ta.classList.add(result.ok ? "ok" : "bad");
      }
    }
  }

  function revealAnswer(q) {
    $("#q-answer").hidden = false;
    const type = qType(q);
    let ans = q.answer;
    if (type === "single" || type === "multi") {
      const letters = String(q.answer || "").toUpperCase().replace(/[^A-D]/g, "").split("");
      const opts = (q.options || []).filter((o) => letters.includes(letterOf(o)));
      ans = letters.join("") + (opts.length ? "　" + opts.join("；") : "");
    } else if (type === "judge") {
      ans = q.answer;
    }
    $("#q-answer-text").textContent = ans;
    const fullEl = $("#q-full-text");
    const fullLabel = $("#q-full-label");
    if (type === "blank") {
      const ref = q.ref ? `（${q.ref}）` : "";
      fullLabel.textContent = `完整原句${ref}`;
      let s = q.full || q.question;
      if (!q.full) {
        const parts = splitAnswer(q.answer);
        s = q.question;
        for (const p of parts) s = s.replace("____", p);
      }
      // 正文前再标一次条文号，方便对照规程
      fullEl.textContent = q.ref ? `【${q.ref}】${s}` : s;
    } else {
      fullLabel.textContent = "解析";
      fullEl.textContent = q.explain || "（无附加解析）";
    }
  }

  function markTried(id, ok) {
    state.store.tried[id] = true;
    if (ok) {
      state.store.history.ok += 1;
      state.store.wrongIds = state.store.wrongIds.filter((x) => x !== id);
    } else {
      state.store.history.bad += 1;
      if (!state.store.wrongIds.includes(id)) state.store.wrongIds.push(id);
      if (!state.sessionWrongIds.includes(id)) state.sessionWrongIds.push(id);
    }
    saveStore();
  }

  function finishAnswer(ok, revealed) {
    const q = currentQ();
    state.answered = true;
    if (revealed) {
      state.revealed += 1;
      state.wrong += 1;
      markTried(q.id, false);
    } else if (ok) {
      state.correct += 1;
      markTried(q.id, true);
    } else {
      state.wrong += 1;
      markTried(q.id, false);
    }
    $("#btn-check").hidden = true;
    $("#btn-show").hidden = true;
    $("#btn-next").hidden = false;
    $("#live-score").textContent = `${state.correct} 对 / ${state.wrong} 错`;
  }

  function onCheck() {
    if (state.answered) return;
    const q = currentQ();
    const result = getUserResult(q);
    if (result.empty) {
      alert(qType(q) === "short" || qType(q) === "blank" ? "请先填写答案" : "请先选择答案");
      return;
    }
    lockInputs(q, result);
    const fb = $("#q-feedback");
    fb.hidden = false;
    if (result.ok) {
      fb.className = "feedback ok";
      fb.textContent =
        qType(q) === "short"
          ? `回答正确（命中要点 ${result.hit}/${result.total}）`
          : "回答正确";
      finishAnswer(true, false);
    } else {
      fb.className = "feedback bad";
      fb.textContent =
        qType(q) === "short"
          ? `要点不足（命中 ${result.hit}/${result.total}，需≥${result.need}），已加入错题本`
          : "回答错误，已加入错题本";
      revealAnswer(q);
      finishAnswer(false, false);
    }
  }

  function onShow() {
    if (state.answered) return;
    const q = currentQ();
    lockInputs(q, { ok: false });
    const fb = $("#q-feedback");
    fb.hidden = false;
    fb.className = "feedback warn";
    fb.textContent = "已查看答案（记为未掌握）";
    revealAnswer(q);
    finishAnswer(false, true);
  }

  function onNext() {
    if (state.index >= state.queue.length - 1) {
      showResult();
      return;
    }
    state.index += 1;
    renderQuestion();
  }

  function showResult() {
    const total = state.correct + state.wrong;
    const pct = total ? Math.round((state.correct / total) * 100) : 0;
    $("#result-title").textContent =
      state.mode === "exam" ? "小测结束" : "本轮练习结束";
    $("#result-sub").textContent = `共 ${state.queue.length} 题 · ${MODE_LABEL[state.mode]}`;
    $("#result-pct").textContent = pct + "%";
    $("#r-ok").textContent = state.correct;
    $("#r-bad").textContent = state.wrong - state.revealed;
    $("#r-skip").textContent = state.revealed;

    const circ = 2 * Math.PI * 52;
    const ring = $("#result-ring");
    ring.style.strokeDasharray = String(circ);
    ring.style.strokeDashoffset = String(circ * (1 - pct / 100));

    $("#btn-retry-wrong").style.display = state.sessionWrongIds.length ? "" : "none";
    showView("#view-result");
    updateHomeStats();
  }

  // events — 用安全绑定，避免某个节点缺失导致整页初始化中断（题库一直显示 0）
  function on(sel, ev, fn) {
    const el = $(sel);
    if (el) el.addEventListener(ev, fn);
  }

  $$(".mode-card").forEach((btn) => {
    btn.addEventListener("click", () => startMode(btn.dataset.mode));
  });

  on("#chapter-chips", "click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    state.chapter = chip.dataset.ch;
    state.section = "all";
    $$("#chapter-chips .chip").forEach((c) => c.classList.toggle("active", c === chip));
    renderSectionChips();
  });

  on("#type-chips", "click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    state.qtype = chip.dataset.type;
    state.section = "all";
    $$("#type-chips .chip").forEach((c) => c.classList.toggle("active", c === chip));
    renderSectionChips();
  });

  on("#btn-back", "click", () => {
    if (confirm("确定退出本次练习？进度不会保留到题号，但错题会保存。")) {
      showView("#view-home");
      updateHomeStats();
    }
  });
  on("#btn-home", "click", () => {
    showView("#view-home");
    updateHomeStats();
  });
  on("#btn-check", "click", onCheck);
  on("#btn-show", "click", onShow);
  on("#btn-next", "click", onNext);
  on("#btn-retry-wrong", "click", () => {
    const ids = new Set(state.sessionWrongIds);
    state.mode = "wrong";
    state.queue = allQuestions().filter((q) => ids.has(q.id));
    if (!state.queue.length) {
      startMode("wrong");
      return;
    }
    state.index = 0;
    state.correct = 0;
    state.wrong = 0;
    state.revealed = 0;
    state.sessionWrongIds = [];
    showView("#view-quiz");
    renderQuestion();
  });

  on("#btn-reset", "click", () => {
    if (confirm("确定清空本地进度和错题本？")) {
      state.store = defaultStore();
      saveStore();
      updateHomeStats();
    }
  });

  document.addEventListener("keydown", (e) => {
    const quiz = $("#view-quiz");
    if (!quiz || !quiz.classList.contains("active")) return;
    if (e.key === "Enter" && !e.shiftKey && e.target.tagName !== "TEXTAREA") {
      e.preventDefault();
      if ($("#btn-next") && !$("#btn-next").hidden) onNext();
      else if ($("#btn-check") && !$("#btn-check").hidden) onCheck();
    }
  });

  // init
  function boot() {
    const n = allQuestions().length;
    if (!n) {
      const tip =
        "<p style='padding:40px;font-family:sans-serif;line-height:1.6'>" +
        "题库未加载（当前为 0）。请用完整地址打开：<br><b>https://guoyuhang0123-eng.github.io/huaneng-quiz/</b><br>" +
        "注意末尾要有 <b>/</b>；或强制刷新后再试。</p>";
      document.body.innerHTML = tip;
      return;
    }
    try {
      renderSectionChips();
      updateHomeStats();
    } catch (err) {
      console.error(err);
      alert("页面初始化异常：" + (err && err.message ? err.message : err));
    }
  }
  boot();
})();
