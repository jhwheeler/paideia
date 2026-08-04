/* Paideia — Seeds of the Logos: study tracker.
   Vanilla JS, no build step. State lives in localStorage and optionally syncs
   to a secret GitHub Gist (last-write-wins by updatedAt). */
"use strict";
(function () {
  var STORAGE_KEY = "paideia-tracker-v71";
  var SYNC_KEY = "paideia-sync-v1";
  var GIST_FILE = "paideia-progress.json";
  var SHOW_PRAYER = true;
  var SHOW_SECONDARY = true;

  // ── persistent state ─────────────────────────────────────
  var track = { units: {}, memos: {}, updatedAt: 0 };
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      var p = JSON.parse(raw);
      if (p && p.units) track = p;
    }
  } catch (e) {}
  if (!track.memos) track.memos = {};
  if (!track.lectio) track.lectio = {};
  if (!track.library) track.library = {};
  if (!track.updatedAt) track.updatedAt = 0;

  var sync = { token: "", gistId: "" };
  try {
    var sraw = localStorage.getItem(SYNC_KEY);
    if (sraw) sync = Object.assign(sync, JSON.parse(sraw));
  } catch (e) {}

  // ── ui state ─────────────────────────────────────────────
  var data = null;
  var expanded = {};
  var open = {};
  var navOpen = false;
  var libNeededOnly = false;
  var syncPanelOpen = false;
  var syncStatus = {
    state: sync.token && sync.gistId ? "idle" : "off",
    msg: "",
  };
  var noteTimers = {};
  var pushTimer = null;
  var dirty = false;

  function saveLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(track));
    } catch (e) {}
  }
  function saveSyncSettings() {
    try {
      localStorage.setItem(SYNC_KEY, JSON.stringify(sync));
    } catch (e) {}
  }
  function touch() {
    track.updatedAt = Date.now();
    dirty = true;
  }
  function mutate() {
    touch();
    saveLocal();
    schedulePush();
  }
  function bump() {
    mutate();
    render();
  }
  function ut(id) {
    if (!track.units[id])
      track.units[id] = { mode: null, items: {}, notes: "" };
    return track.units[id];
  }

  // ── gist sync ────────────────────────────────────────────
  function ghHeaders() {
    return {
      Authorization: "Bearer " + sync.token,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    };
  }
  function statusLabel() {
    switch (syncStatus.state) {
      case "off":
        return "Sync off";
      case "idle":
        return "Sync ready";
      case "syncing":
        return syncStatus.msg || "Syncing…";
      case "synced":
        return "Synced";
      case "error":
        return "Sync error" + (syncStatus.msg ? " — " + syncStatus.msg : "");
    }
    return "";
  }
  function setSync(state, msg) {
    syncStatus = { state: state, msg: msg || "" };
    var el = document.getElementById("sync-status");
    if (el) {
      el.textContent = statusLabel();
      el.className = "sync-status sync-" + state;
    }
  }
  function syncEnabled() {
    return !!(sync.token && sync.gistId);
  }

  function pullRemote() {
    if (!syncEnabled()) return Promise.resolve();
    setSync("syncing", "Fetching…");
    return fetch("https://api.github.com/gists/" + sync.gistId, {
      headers: ghHeaders(),
    })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (g) {
        var f = g.files && g.files[GIST_FILE];
        var remote = null;
        if (f && f.content) {
          try {
            remote = JSON.parse(f.content);
          } catch (e) {}
        }
        if (
          remote &&
          remote.units &&
          (remote.updatedAt || 0) > (track.updatedAt || 0)
        ) {
          track = remote;
          if (!track.memos) track.memos = {};
          if (!track.lectio) track.lectio = {};
          if (!track.library) track.library = {};
          saveLocal();
          setSync("synced");
          render();
        } else if (
          (track.updatedAt || 0) > ((remote && remote.updatedAt) || 0)
        ) {
          return pushNow();
        } else {
          setSync("synced");
        }
      })
      .catch(function (e) {
        setSync("error", e.message || String(e));
      });
  }

  function schedulePush() {
    if (!syncEnabled()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, 1500);
  }

  function pushNow(opts) {
    if (!syncEnabled()) return Promise.resolve();
    clearTimeout(pushTimer);
    setSync("syncing", "Saving…");
    var files = {};
    files[GIST_FILE] = { content: JSON.stringify(track) };
    var body = JSON.stringify({ files: files });
    return fetch("https://api.github.com/gists/" + sync.gistId, {
      method: "PATCH",
      headers: ghHeaders(),
      body: body,
      keepalive: !!(opts && opts.keepalive),
    })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        dirty = false;
        setSync("synced");
      })
      .catch(function (e) {
        setSync("error", e.message || String(e));
      });
  }

  function connectSync(token, gistId) {
    sync.token = (token || "").trim();
    sync.gistId = (gistId || "").trim();
    if (!sync.token) {
      saveSyncSettings();
      setSync("off");
      render();
      return;
    }
    setSync("syncing", "Connecting…");
    var ready;
    if (sync.gistId) {
      ready = Promise.resolve();
    } else {
      var files = {};
      files[GIST_FILE] = { content: JSON.stringify(track) };
      ready = fetch("https://api.github.com/gists", {
        method: "POST",
        headers: ghHeaders(),
        body: JSON.stringify({
          description: "Paideia study tracker — progress",
          public: false,
          files: files,
        }),
      })
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .then(function (g) {
          sync.gistId = g.id;
        });
    }
    ready
      .then(function () {
        saveSyncSettings();
        return pullRemote();
      })
      .then(function () {
        syncPanelOpen = false;
        render();
      })
      .catch(function (e) {
        setSync("error", e.message || String(e));
      });
  }

  function disconnectSync() {
    sync = { token: "", gistId: "" };
    saveSyncSettings();
    syncStatus = { state: "off", msg: "" };
    render();
  }

  // Chi-Rho mark — same drawing as the favicon, in the sidebar's lighter gold
  var CHI_RHO =
    "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><g fill='none' stroke='%23e1ad66' stroke-width='10' stroke-linecap='round'><path d='M50 8 V92'/><path d='M50 12 C76 12 76 44 50 44'/><path d='M26 40 74 90 M74 40 26 90'/></g></svg>";

  // ── dom helper ───────────────────────────────────────────
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        var v = attrs[k];
        if (v == null || v === false) continue;
        if (k === "style") el.style.cssText = v;
        else if (k === "class") el.className = v;
        else if (k === "checked") el.checked = !!v;
        else if (k === "indeterminate") el.indeterminate = !!v;
        else if (k === "value") el.value = v;
        else if (k.indexOf("on") === 0) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v);
      }
    }
    for (var i = 2; i < arguments.length; i++) appendChildren(el, arguments[i]);
    return el;
  }
  function appendChildren(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) {
      for (var i = 0; i < c.length; i++) appendChildren(el, c[i]);
      return;
    }
    el.appendChild(c.nodeType ? c : document.createTextNode(c));
  }

  function jumpTo(anchor) {
    return function () {
      if (navOpen) {
        navOpen = false;
        render();
      }
      var el = document.getElementById(anchor);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    };
  }
  function labelStrong(b) {
    return b.label ? h("strong", null, b.label + ": ") : null;
  }

  // ── tri-state checks ─────────────────────────────────────
  // not started (absent) → 'wip' (in progress) → true (done).
  // Old saved data stores true, so nothing already checked shifts.
  var CYCLE_HINT = "Click: not started → in progress → done";
  function nextMark(v) {
    return v === "wip" ? true : v === true ? null : "wip";
  }
  function setMark(obj, key) {
    var next = nextMark(obj[key]);
    if (next == null) delete obj[key];
    else obj[key] = next;
    bump();
  }
  function checkState(v) {
    return { done: v === true, wip: v === "wip" };
  }
  function checkTextClass(s) {
    return "check-text" + (s.done ? " done" : s.wip ? " wip" : "");
  }

  // ── counters (full pass, independent of what is expanded) ─
  function compute() {
    var c = {
      totalUnits: 0,
      doneUnits: 0,
      coreN: 0,
      deepN: 0,
      resN: 0,
      essayN: 0,
      textsRead: 0,
      textsTotal: 0,
      studiesDone: 0,
      memosDone: 0,
      memosTotal: 0,
      lectioDone: 0,
      lectioTotal: 0,
      libOwned: 0,
      libOrdered: 0,
      libTotal: 0,
      reading: [],
      stages: [],
    };
    data.back.forEach(function (sec) {
      (sec.blocks || []).forEach(function (b) {
        if (b.kind !== "library") return;
        b.items.forEach(function (it) {
          c.libTotal++;
          var v = track.library[it.id];
          if (v === true) c.libOwned++;
          else if (v === "wip") c.libOrdered++;
        });
      });
    });
    data.stages.forEach(function (st) {
      var sDone = 0,
        sTotal = 0;
      (st.intro || []).forEach(function (b, bi) {
        if (b.type === "para" && b.kind === "memo") {
          c.memosTotal++;
          if (track.memos[st.id + "-" + bi]) c.memosDone++;
        } else if (b.type === "list" && b.kind === "lectio") {
          b.items.forEach(function (it, ii) {
            c.lectioTotal++;
            var lv = track.lectio[st.id + "-" + ii];
            if (lv === true) c.lectioDone++;
            else if (lv === "wip")
              c.reading.push(typeof it === "string" ? it : it.t);
          });
        }
      });
      st.units.forEach(function (u) {
        if (u.kind === "divider") return;
        var t = ut(u.id);
        var isSyn = u.kind === "synthesis";
        c.totalUnits++;
        sTotal++;
        if (isSyn) {
          if (t.mode === "done") {
            c.doneUnits++;
            sDone++;
            c.essayN++;
          }
        } else if (t.mode) {
          c.doneUnits++;
          sDone++;
          if (t.mode === "core") c.coreN++;
          else if (t.mode === "deep") c.deepN++;
          else if (t.mode === "research") c.resN++;
        }
        (u.blocks || []).forEach(function (b, bi) {
          if (!SHOW_PRAYER && b.kind === "prayer") return;
          if (!SHOW_SECONDARY && b.kind === "secondary") return;
          if (b.type === "para" && b.kind === "memo") {
            c.memosTotal++;
            if (track.memos[u.id + "-m" + bi]) c.memosDone++;
          } else if (b.kind === "texts" || b.kind === "study") {
            b.items.forEach(function (it, ii) {
              var v = t.items[bi + "-" + ii];
              if (b.kind === "texts") {
                c.textsTotal++;
                if (v === true) c.textsRead++;
                else if (v === "wip") c.reading.push(it.split(" (")[0]);
              } else if (v === true) c.studiesDone++;
            });
          }
        });
      });
      c.stages.push({ done: sDone, total: sTotal });
    });
    return c;
  }

  // ── sidebar ──────────────────────────────────────────────
  function syncSection() {
    return h(
      "div",
      { class: "side-sync" },
      h(
        "div",
        { class: "side-sync-row" },
        h(
          "span",
          { id: "sync-status", class: "sync-status sync-" + syncStatus.state },
          statusLabel(),
        ),
        h(
          "button",
          {
            class: "sync-gear",
            onclick: function () {
              syncPanelOpen = !syncPanelOpen;
              render();
            },
          },
          syncPanelOpen ? "Close" : syncEnabled() ? "Settings" : "Set up",
        ),
      ),
      syncPanelOpen &&
        h(
          "div",
          { class: "sync-panel" },
          h(
            "p",
            { class: "sync-help" },
            "Syncs progress to a secret GitHub Gist. Create a ",
            h(
              "a",
              {
                href: "https://github.com/settings/tokens/new?scopes=gist&description=Paideia+tracker",
                target: "_blank",
                rel: "noreferrer",
              },
              "classic token with the gist scope",
            ),
            " and paste it here — it is stored only in this browser. Leave the Gist ID blank the first time; on other devices, paste the same token and the Gist ID shown here.",
          ),
          h("input", {
            id: "sync-token",
            class: "sync-input",
            type: "password",
            placeholder: "GitHub token (gist scope)",
            value: sync.token,
          }),
          h("input", {
            id: "sync-gist",
            class: "sync-input",
            type: "text",
            placeholder: "Gist ID (blank = create new)",
            value: sync.gistId,
          }),
          h(
            "div",
            { class: "sync-actions" },
            h(
              "button",
              {
                class: "sync-btn",
                onclick: function () {
                  connectSync(
                    document.getElementById("sync-token").value,
                    document.getElementById("sync-gist").value,
                  );
                },
              },
              "Connect",
            ),
            sync.token &&
              h(
                "button",
                { class: "sync-btn sync-btn-ghost", onclick: disconnectSync },
                "Disconnect",
              ),
          ),
        ),
    );
  }

  function sidebar(c) {
    var body = null;
    if (data && c) {
      var pct = c.totalUnits
        ? Math.round((c.doneUnits / c.totalUnits) * 100)
        : 0;
      var docLinks = data.front
        .map(function (s, i) {
          return { key: "f" + i, title: s.title };
        })
        .concat(
          data.back.map(function (s, i) {
            return { key: "b" + i, title: s.title };
          }),
        );
      body = h(
        "div",
        { class: "side-body" },
        h(
          "div",
          { class: "side-progress" },
          h(
            "div",
            { class: "side-progress-row" },
            h("span", { class: "side-progress-label" }, "Progress"),
            h("span", null, c.doneUnits + " / " + c.totalUnits + " units"),
          ),
          h(
            "div",
            { class: "side-bar" },
            h("div", { class: "side-bar-fill", style: "width:" + pct + "%" }),
          ),
          h(
            "div",
            { class: "side-counts" },
            h("span", null, "Texts " + c.textsRead + "/" + c.textsTotal),
            h("span", null, "Lectio " + c.lectioDone + "/" + c.lectioTotal),
            h("span", null, "Library " + c.libOwned + "/" + c.libTotal),
            c.reading.length
              ? h("span", null, "Reading " + c.reading.length)
              : null,
            h("span", null, "Core " + c.coreN),
            h("span", null, "Deep " + c.deepN),
            h("span", null, "Research " + c.resN),
            h("span", null, "Essays " + c.essayN),
          ),
        ),
        h(
          "div",
          { class: "side-stages" },
          data.stages.reduce(function (rows, st, i) {
            var sc = c.stages[i];
            if (st.part)
              rows.push(
                h("div", { class: "side-part" }, st.part.name.split(":")[0]),
              );
            rows.push(
              h(
                "div",
                { class: "side-stage", onclick: jumpTo("stage-" + st.id) },
              h(
                "div",
                { class: "side-stage-info" },
                h("div", { class: "side-stage-num" }, st.num),
                h("div", { class: "side-stage-title" }, st.title),
              ),
                h(
                  "div",
                  {
                    class:
                      "side-stage-count" +
                      (sc.done === sc.total && sc.total > 0 ? " full" : ""),
                  },
                  sc.done + "/" + sc.total,
                ),
              ),
            );
            return rows;
          }, []),
        ),
        h(
          "div",
          { class: "side-docs" },
          docLinks.map(function (d) {
            return h(
              "div",
              { class: "side-doc", onclick: jumpTo("doc-" + d.key) },
              d.title,
            );
          }),
        ),
        syncSection(),
        h(
          "div",
          { class: "side-quote" },
          "σπέρμα τοῦ λόγου",
          h("br"),
          "— Justin Martyr, 2 Apol. 8",
        ),
      );
    }
    return h(
      "nav",
      { class: "sidebar" + (navOpen ? " open" : "") },
      h(
        "div",
        { class: "side-head" },
        h(
          "div",
          null,
          h(
            "div",
            { class: "side-brand-row" },
            h("img", { class: "side-mark", src: CHI_RHO, alt: "" }),
            h("div", { class: "side-brand" }, "Paideia"),
          ),
          h("div", { class: "side-sub" }, "Seeds of the Logos"),
          h("div", { class: "side-version" }, data ? data.version : ""),
        ),
        h(
          "button",
          {
            class: "nav-toggle",
            "aria-expanded": String(navOpen),
            onclick: function () {
              navOpen = !navOpen;
              render();
            },
          },
          navOpen ? "✕ Close" : "☰ Contents",
        ),
      ),
      body,
    );
  }

  // ── shared blocks ────────────────────────────────────────
  function memoBox(key, text) {
    var on = !!track.memos[key];
    return h(
      "div",
      { class: "memo-box" },
      h("input", {
        type: "checkbox",
        checked: on,
        onchange: function () {
          track.memos[key] = !track.memos[key];
          bump();
        },
      }),
      h("p", null, h("strong", null, "Ἀπὸ στήθους: "), text),
    );
  }
  function genList(b) {
    return h(
      "div",
      { class: "gen-list" },
      b.label && h("div", { class: "gen-list-label" }, b.label),
      h(
        "ul",
        null,
        (b.items || []).map(function (it) {
          return h("li", null, typeof it === "string" ? it : it.t);
        }),
      ),
    );
  }

  // ── documents (front / back matter) ──────────────────────
  // library items are keyed by their id in plan-data, so plan edits never
  // shift ownership marks
  var LIB_HINT = "Click: needed → ordered → owned";
  function libraryList(b) {
    var owned = 0;
    b.items.forEach(function (it) {
      if (track.library[it.id] === true) owned++;
    });
    var shown = libNeededOnly
      ? b.items.filter(function (it) {
          return track.library[it.id] !== true;
        })
      : b.items;
    if (libNeededOnly && !shown.length) return null;
    return h(
      "div",
      { class: "checklist" },
      h(
        "div",
        { class: "checklist-label lib-head" },
        h("span", null, b.label || ""),
        h("span", { class: "lib-count" }, owned + "/" + b.items.length),
      ),
      h(
        "div",
        { class: "checklist-items" },
        shown.map(function (it) {
          var s = checkState(track.library[it.id]);
          return h(
            "label",
            { class: "check-row", title: LIB_HINT },
            h("input", {
              type: "checkbox",
              checked: s.done,
              indeterminate: s.wip,
              onclick: function (e) {
                e.preventDefault();
                setMark(track.library, it.id);
              },
            }),
            h(
              "span",
              { class: "check-text" + (s.done ? " lib-owned" : "") },
              it.t,
            ),
            s.wip ? h("span", { class: "wip-chip" }, "ordered") : null,
          );
        }),
      ),
    );
  }
  function libToolbar(sec) {
    var total = 0,
      owned = 0,
      ordered = 0;
    sec.blocks.forEach(function (b) {
      if (b.kind !== "library") return;
      b.items.forEach(function (it) {
        total++;
        var v = track.library[it.id];
        if (v === true) owned++;
        else if (v === "wip") ordered++;
      });
    });
    return h(
      "div",
      { class: "lib-toolbar" },
      h(
        "span",
        { class: "lib-summary" },
        owned +
          " of " +
          total +
          " owned" +
          (ordered ? " · " + ordered + " ordered" : ""),
      ),
      h(
        "button",
        {
          class: "btn-line " + (libNeededOnly ? "accent" : "neutral"),
          onclick: function () {
            libNeededOnly = !libNeededOnly;
            render();
          },
        },
        libNeededOnly ? "Showing needed only" : "Show needed only",
      ),
    );
  }
  function docBlock(b) {
    if (b.type === "subhead") return h("h3", { class: "doc-subhead" }, b.text);
    if (b.kind === "library") return libraryList(b);
    if (b.type === "list") return genList(b);
    return h("p", { class: "doc-para" }, labelStrong(b), b.text);
  }
  function docSection(sec, key) {
    var isOpen = !!open[key];
    var hasLibrary = sec.blocks.some(function (b) {
      return b.kind === "library";
    });
    return h(
      "section",
      { id: "doc-" + key, class: "doc-card" },
      h(
        "div",
        {
          class: "doc-head",
          onclick: function () {
            open[key] = !open[key];
            render();
          },
        },
        h("span", { class: "doc-title" }, sec.title),
        h("span", { class: "chev" }, isOpen ? "▾" : "▸"),
      ),
      isOpen &&
        h(
          "div",
          { class: "doc-body" },
          hasLibrary && libToolbar(sec),
          sec.blocks.map(docBlock),
        ),
    );
  }

  // ── stages and units ─────────────────────────────────────
  // lectio items are keyed by stage id + item index (one lectio list per stage),
  // deliberately independent of block positions so future plan edits don't shift them
  function lectioList(st, b) {
    return h(
      "div",
      { class: "checklist" },
      b.label && h("div", { class: "checklist-label" }, b.label),
      b.lead && h("div", { class: "checklist-lead" }, b.lead),
      h(
        "div",
        { class: "checklist-items" },
        b.items.map(function (it, ii) {
          var key = st.id + "-" + ii;
          var s = checkState(track.lectio[key]);
          if (typeof it === "string") it = { t: it };
          return h(
            "label",
            { class: "check-row", title: CYCLE_HINT },
            h("input", {
              type: "checkbox",
              checked: s.done,
              indeterminate: s.wip,
              onclick: function (e) {
                e.preventDefault();
                setMark(track.lectio, key);
              },
            }),
            h(
              "div",
              { class: "check-body" },
              h(
                "div",
                null,
                h("span", { class: checkTextClass(s) }, it.t),
                it.when ? h("span", { class: "check-when" }, it.when) : null,
                s.wip ? h("span", { class: "wip-chip" }, "reading") : null,
              ),
              it.d ? h("div", { class: "check-desc" }, it.d) : null,
            ),
          );
        }),
      ),
    );
  }

  function introBlock(st, b, bi) {
    if (b.type === "para" && b.kind === "memo")
      return memoBox(st.id + "-" + bi, b.text);
    if (!SHOW_SECONDARY && b.kind === "secondary") return null;
    if (b.type === "list" && b.kind === "lectio") return lectioList(st, b);
    if (b.type === "list") return genList(b);
    return h("p", { class: "intro-para" }, labelStrong(b), b.text);
  }

  function unitBlock(u, t, b, bi) {
    if (!SHOW_PRAYER && b.kind === "prayer") return null;
    if (!SHOW_SECONDARY && b.kind === "secondary") return null;
    if (b.type === "subhead") return h("h4", { class: "unit-subhead" }, b.text);
    if (b.type === "para" && b.kind === "memo")
      return memoBox(u.id + "-m" + bi, b.text);
    if (b.type === "para") {
      var muted =
        b.kind === "note" || b.kind === "secondary" || b.kind === "seeds";
      return h(
        "p",
        { class: "unit-para" + (muted ? " muted" : "") },
        labelStrong(b),
        b.text,
      );
    }
    if (b.kind === "texts" || b.kind === "study") {
      return h(
        "div",
        { class: "checklist" },
        h(
          "div",
          { class: "checklist-label" },
          b.kind === "texts" ? (b.label || "Texts") : b.label,
        ),
        h(
          "div",
          { class: "checklist-items" },
          b.items.map(function (it, ii) {
            var key = bi + "-" + ii;
            var s = checkState(t.items[key]);
            return h(
              "label",
              { class: "check-row", title: CYCLE_HINT },
              h("input", {
                type: "checkbox",
                checked: s.done,
                indeterminate: s.wip,
                onclick: function (e) {
                  e.preventDefault();
                  setMark(t.items, key);
                },
              }),
              h("span", { class: checkTextClass(s) }, it),
              s.wip ? h("span", { class: "wip-chip" }, "reading") : null,
            );
          }),
        ),
      );
    }
    if (b.kind === "questions") {
      return h(
        "div",
        { class: "questions" },
        h("div", { class: "questions-label" }, b.label),
        h(
          "ol",
          null,
          b.items.map(function (q) {
            return h("li", null, q);
          }),
        ),
      );
    }
    if (b.kind === "prayer") {
      return h(
        "div",
        { class: "prayer-box" },
        h("div", { class: "prayer-head" }, "☩ Πρὸς προσευχὴν καὶ θεωρίαν"),
        h(
          "div",
          { class: "prayer-items" },
          b.items.map(function (pr) {
            return h("p", null, pr);
          }),
        ),
      );
    }
    return genList(b);
  }

  var MODES = [
    ["core", "Core", "Core: primary texts, notes, one question answered"],
    ["deep", "Deep", "Deep: + Greek work, a companion, one exercise"],
    ["research", "Research", "Research: formal paper or translation dossier"],
  ];

  function unitCard(u) {
    if (u.kind === "divider")
      return h("div", { class: "unit-divider" }, u.num + " — " + u.title);
    var t = ut(u.id);
    var isSyn = u.kind === "synthesis";
    var isOpen = !!expanded[u.id];
    var toggle = function () {
      expanded[u.id] = !expanded[u.id];
      render();
    };

    var uTexts = 0,
      uTextsOn = 0,
      uWip = false;
    (u.blocks || []).forEach(function (b, bi) {
      if (b.kind !== "texts" && b.kind !== "study") return;
      b.items.forEach(function (it, ii) {
        var v = t.items[bi + "-" + ii];
        if (b.kind === "texts") {
          uTexts++;
          if (v === true) uTextsOn++;
        }
        if (v === "wip") uWip = true;
      });
    });
    var doneFlag = isSyn ? t.mode === "done" : !!t.mode;
    var meta = isSyn
      ? "Stage synthesis · 3,000–5,000 words"
      : t.mode
        ? "Completed — " + t.mode
        : uWip
          ? "In progress"
          : "Not started";
    if (uTexts) meta += " · " + uTextsOn + "/" + uTexts + " texts";
    if (t.notes) meta += " · notes";

    var control;
    if (isSyn) {
      control = h(
        "label",
        { class: "syn-check" },
        h("input", {
          type: "checkbox",
          checked: t.mode === "done",
          onchange: function () {
            t.mode = t.mode === "done" ? null : "done";
            bump();
          },
        }),
        "Essay written",
      );
    } else {
      control = h(
        "div",
        { class: "mode-seg" },
        MODES.map(function (m) {
          var sel = t.mode === m[0];
          return h(
            "button",
            {
              class: "mode-btn" + (sel ? " sel" : ""),
              title: m[2],
              onclick: function (e) {
                e.stopPropagation();
                t.mode = sel ? null : m[0];
                bump();
              },
            },
            m[1],
          );
        }),
      );
    }

    return h(
      "article",
      { class: "unit-card" },
      h(
        "div",
        { class: "unit-head" },
        h(
          "div",
          { class: "unit-num" + (doneFlag ? " done" : ""), onclick: toggle },
          u.num || "·",
        ),
        h(
          "div",
          { class: "unit-titlebox", onclick: toggle },
          h("div", { class: "unit-title" }, u.title),
          h("div", { class: "unit-meta" }, meta),
        ),
        h(
          "div",
          { class: "unit-controls" },
          u.level
            ? h("span", { class: "level-chip" }, "Greek: " + u.level)
            : null,
          control,
          h(
            "span",
            { class: "chev unit-chev", onclick: toggle },
            isOpen ? "▾" : "▸",
          ),
        ),
      ),
      isOpen &&
        h(
          "div",
          { class: "unit-body" },
          (u.blocks || []).map(function (b, bi) {
            return unitBlock(u, t, b, bi);
          }),
          h(
            "div",
            { class: "notes" },
            h("div", { class: "notes-label" }, "Notes"),
            h("textarea", {
              class: "notes-ta",
              placeholder: "Marginalia, provisional answers, glossary entries…",
              value: t.notes || "",
              oninput: function (e) {
                t.notes = e.target.value;
                clearTimeout(noteTimers[u.id]);
                noteTimers[u.id] = setTimeout(function () {
                  mutate();
                }, 400);
              },
            }),
          ),
        ),
    );
  }

  function stageSection(st, sc) {
    return h(
      "div",
      null,
      st.part &&
        h(
          "div",
          { class: "part-banner" },
          h("div", { class: "part-name" }, st.part.name),
          h("p", { class: "part-desc" }, st.part.desc),
        ),
      h(
        "section",
        { id: "stage-" + st.id, class: "stage" },
        h(
          "div",
          { class: "stage-head" },
          h("span", { class: "stage-num" }, st.num),
          h("h2", { class: "stage-title" }, st.title),
          h("span", { class: "stage-count" }, sc.done + " / " + sc.total),
        ),
        h(
          "div",
          { class: "stage-intro" },
          (st.intro || []).map(function (b, bi) {
            return introBlock(st, b, bi);
          }),
        ),
        h("div", { class: "unit-list" }, st.units.map(unitCard)),
      ),
    );
  }

  // ── page ─────────────────────────────────────────────────
  function pageHeader(c) {
    return h(
      "header",
      { class: "page-head" },
      h(
        "div",
        { class: "page-head-top" },
        h(
          "div",
          null,
          h(
            "div",
            { class: "kicker" },
            "A multi-year reading plan · study tracker",
          ),
          h("h1", { class: "page-title" }, "Paideia — Seeds of the Logos"),
          h(
            "div",
            { class: "page-sub" },
            "Greek philosophy, Scripture, and the Fathers — from Homer to Holy Wisdom",
          ),
        ),
        h(
          "div",
          { class: "page-actions" },
          h(
            "button",
            {
              class: "btn-line accent",
              onclick: function () {
                data.stages.forEach(function (st) {
                  st.units.forEach(function (u) {
                    if (u.id) expanded[u.id] = true;
                  });
                });
                render();
              },
            },
            "Expand all",
          ),
          h(
            "button",
            {
              class: "btn-line neutral",
              onclick: function () {
                expanded = {};
                render();
              },
            },
            "Collapse all",
          ),
        ),
      ),
      h(
        "div",
        { class: "page-stats" },
        h(
          "span",
          null,
          h("strong", null, String(c.textsRead)),
          " of " + c.textsTotal + " texts read",
        ),
        h(
          "span",
          null,
          h("strong", null, String(c.studiesDone)),
          " textual studies",
        ),
        h(
          "span",
          null,
          h("strong", null, String(c.memosDone)),
          " of " + c.memosTotal + " pieces ἀπὸ στήθους",
        ),
        h(
          "span",
          null,
          h("strong", null, String(c.lectioDone)),
          " of " + c.lectioTotal + " books in lectio continua",
        ),
      ),
      c.reading.length
        ? h(
            "div",
            { class: "page-now" },
            h("span", { class: "page-now-label" }, "Now reading"),
            c.reading.join(" · "),
          )
        : null,
    );
  }

  function main(c) {
    if (!data)
      return h(
        "main",
        { class: "main" },
        h("div", { class: "loading" }, "Loading the plan…"),
      );
    return h(
      "main",
      { class: "main" },
      pageHeader(c),
      h(
        "div",
        { class: "doc-stack" },
        data.front.map(function (sec, i) {
          return docSection(sec, "f" + i);
        }),
      ),
      data.stages.map(function (st, i) {
        return stageSection(st, c.stages[i]);
      }),
      h(
        "div",
        { class: "doc-stack back" },
        data.back.map(function (sec, i) {
          return docSection(sec, "b" + i);
        }),
      ),
      h(
        "footer",
        { class: "page-foot" },
        h(
          "a",
          {
            href: "https://github.com/jhwheeler/paideia",
            target: "_blank",
            rel: "noreferrer",
          },
          "GitHub",
        ),
        h("span", { class: "foot-sep" }, "·"),
        h(
          "span",
          null,
          h("span", { class: "copyleft" }, "©"),
          " " + new Date().getFullYear() + " Jackson Holiday Wheeler",
        ),
        h("span", { class: "foot-sep" }, "·"),
        h(
          "a",
          {
            href: "https://creativecommons.org/licenses/by-sa/4.0/",
            target: "_blank",
            rel: "noreferrer",
          },
          "CC BY-SA 4.0",
        ),
      ),
    );
  }

  function render() {
    var c = data ? compute() : null;
    var root = document.getElementById("app");
    root.replaceChildren(h("div", { class: "layout" }, sidebar(c), main(c)));
  }

  // ── boot ─────────────────────────────────────────────────
  function afterData() {
    render();
    if (syncEnabled()) pullRemote();
  }
  render();
  fetch("plan-data.json")
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (d) {
      data = d;
      afterData();
    })
    .catch(function () {
      if (window.PLAN_DATA) {
        data = window.PLAN_DATA;
        afterData();
      } else {
        var root = document.getElementById("app");
        root.replaceChildren(
          h("div", { class: "loading" }, "Could not load plan-data.json."),
        );
      }
    });

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden" && dirty && syncEnabled())
      pushNow({ keepalive: true });
  });
})();
