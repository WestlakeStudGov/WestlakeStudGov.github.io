/* Westlake Student Government site.
   All content comes from data/site.json. Edit it through the site's Edit mode, not here. */
(function () {
  "use strict";
  document.documentElement.classList.add("js");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hasGsap = !!(window.gsap && window.ScrollTrigger);
  if (hasGsap) {
    gsap.registerPlugin(ScrollTrigger);
    // Phones show and hide the address bar while scrolling, which resizes the page.
    // Ignoring that stops scroll effects from re-measuring and jumping mid-scroll.
    ScrollTrigger.config({ ignoreMobileResize: true });
  }
  const isTouch = window.matchMedia("(hover: none), (pointer: coarse)").matches;
  // How far scroll-linked effects trail behind the scroll: a little trail reads as smooth, none reads as jittery
  const SMOOTH = isTouch ? 0.9 : 0.6;
  if (reduceMotion || !hasGsap) document.documentElement.classList.add("reduce");

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const WSG = (window.WSG = {
    data: null,
    totals: { pages: {} },
    editMode: false,
    localImgs: {}, // uploaded-but-not-yet-live images: path -> data URL
    onRender: [],
  });

  /* ---------------- helpers ---------------- */
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  WSG.esc = esc;
  const paras = (t) =>
    String(t || "")
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
      .join("");
  const safeUrl = (u) => {
    u = String(u || "").trim();
    if (!u) return "";
    if (/^mailto:/i.test(u)) return u;
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    return u;
  };
  WSG.safeUrl = safeUrl;

  function phSvg(label) {
    const t = esc(label || "Photo coming soon");
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 600' preserveAspectRatio='xMidYMid slice'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#152E52'/><stop offset='1' stop-color='#6CA9E2'/></linearGradient></defs><rect width='800' height='600' fill='url(#g)'/><g opacity='.12' fill='#fff'><path d='M470 40 250 340h130l-40 220 230-320H440z'/></g><path d='M412 232l-46 64h32l-9 50 52-72h-33z' fill='#C5B683'/><text x='400' y='150' text-anchor='middle' font-family='Arial' font-size='22' letter-spacing='3' fill='#fff' opacity='.85'>${t.toUpperCase()}</text></svg>`;
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }
  function imgSrc(src, label) {
    if (!src) return phSvg(label);
    if (WSG.localImgs[src]) return WSG.localImgs[src];
    return src;
  }
  WSG.imgSrc = imgSrc;
  function img(src, alt, label, extra = "") {
    return `<img src="${esc(imgSrc(src, label))}" alt="${esc(alt || "")}" loading="lazy" decoding="async" ${extra}>`;
  }
  const media = (src, alt, label, cls = "") => `<div class="media ${cls}">${img(src, alt, label)}</div>`;

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const toDate = (s) => (s ? new Date(s.length <= 10 ? s + "T00:00" : s) : null);
  const fmtTime = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  // Events can repeat on extra dates (moreDates). Each date uses the same times as the first one.
  const dayEnd = (str) => {
    const d = toDate(str);
    if (!d || isNaN(d)) return null;
    if (str.length <= 10) d.setHours(23, 59, 59);
    return d;
  };
  function occurrences(ev) {
    if (!ev.start) return [];
    const t = ev.start.length > 10 ? ev.start.slice(10) : "";
    const et = ev.end && ev.end.slice(0, 10) === ev.start.slice(0, 10) ? ev.end.slice(10) : null;
    const list = [{ start: ev.start, end: ev.end || "" }].concat(
      (ev.moreDates || []).filter((x) => x && x.date).map((x) => ({ start: x.date.slice(0, 10) + t, end: et != null ? x.date.slice(0, 10) + et : "" }))
    );
    return list.sort((a, b) => a.start.localeCompare(b.start));
  }
  // The next date that hasn't happened yet (or the last one, once they're all over)
  function nextOcc(ev) {
    const occ = occurrences(ev);
    if (occ.length <= 1) return { ...ev, _left: 0 };
    const now = new Date();
    const i = occ.findIndex((o) => (dayEnd(o.end || o.start) || 0) >= now);
    const pick = i < 0 ? occ[occ.length - 1] : occ[i];
    return { ...ev, start: pick.start, end: pick.end, _left: i < 0 ? 0 : occ.length - i - 1 };
  }
  WSG.occurrences = occurrences;
  const startOfToday = () => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  };
  // "Today" / "Tomorrow" for those two days, otherwise nothing
  function relDay(d) {
    if (!d || isNaN(d)) return "";
    const n = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - startOfToday()) / 864e5);
    return n === 0 ? "Today" : n === 1 ? "Tomorrow" : "";
  }
  // Happening at some point today (a single date, one of several dates, or a range that includes today)
  function happeningToday(ev) {
    if (isPast(ev)) return false;
    const t0 = startOfToday();
    return occurrences(ev).some((o) => {
      const a = toDate(o.start.slice(0, 10));
      const b = toDate((o.end || o.start).slice(0, 10));
      return a && b && a <= t0 && b >= t0;
    });
  }
  WSG.happeningToday = (e) => happeningToday(e);
  function fmtWhen(ev0) {
    const ev = nextOcc(ev0);
    const s = toDate(ev.start);
    if (!s || isNaN(s)) return ev.done ? "Earlier this year" : ev.timeNote ? ev.timeNote : "Date to be announced";
    const e = toDate(ev.end);
    const multiDay = e && !isNaN(e) && e.toDateString() !== s.toDateString();
    let left = ev._left || 0;
    let out;
    const rel = relDay(s);
    if (multiDay && s < startOfToday() && dayEnd(ev.end) >= new Date()) {
      // already started and still going, like a week of lunch activities
      out = `Now through ${relDay(e) || `${MONTHS[e.getMonth()]} ${e.getDate()}`}`;
    } else {
      out = rel || `${DAYS[s.getDay()]}, ${MONTHS[s.getMonth()]} ${s.getDate()}`;
      if (rel === "Today" && left) {
        // the same event again tomorrow (like a play's second night)
        const occ = occurrences(ev0);
        const i = occ.findIndex((o) => o.start === ev.start);
        if (occ[i + 1] && relDay(toDate(occ[i + 1].start)) === "Tomorrow") {
          out = "Today and tomorrow";
          left -= 1;
        }
      }
      if (multiDay) out += ` – ${relDay(e) || `${MONTHS[e.getMonth()]} ${e.getDate()}`}`;
    }
    const hasTime = ev.start.length > 10 && !ev.timeNote;
    if (hasTime) out += ` · ${fmtTime(s)}`;
    if (e && !isNaN(e) && !multiDay && ev.end.length > 10 && !ev.timeNote) out += ` – ${fmtTime(e)}`;
    if (ev.timeNote) out += ` · ${ev.timeNote}`;
    if (left) out += ` (+${left} more date${left === 1 ? "" : "s"})`;
    return out;
  }
  const dateBlock = (ev) => {
    const s = toDate(nextOcc(ev).start);
    if (!s || isNaN(s)) return `<div class="ev-date"><small>TBA</small><b>–</b></div>`;
    return `<div class="ev-date"><small>${MONTHS[s.getMonth()].toUpperCase()}</small><b>${s.getDate()}</b></div>`;
  };
  const isPast = (ev) => {
    if (ev.done) return true;
    const occ = occurrences(ev);
    if (occ.length > 1) return (dayEnd(occ[occ.length - 1].end || occ[occ.length - 1].start) || Infinity) < new Date();
    const d = toDate(ev.end) || toDate(ev.start);
    if (!d || isNaN(d)) return false;
    const end = ev.end || ev.start;
    if (end.length <= 10) d.setHours(23, 59);
    return d < new Date();
  };
  WSG.isPast = (e) => isPast(e);
  const byStart = (a, b) => (nextOcc(a).start || "9999").localeCompare(nextOcc(b).start || "9999");
  WSG.fmtWhen = fmtWhen;

  /* ---------------- data lookups ---------------- */
  const D = () => WSG.data;
  const person = (id) => D().people.find((p) => p.id === id);
  const committee = (id) => D().committees.find((c) => c.id === id);
  const audience = (id) => D().audiences.find((a) => a.id === id);
  const TEAM_COLORS = ["#E03A3E", "#2F7BE0", "#2DB45D", "#F5C518", "#9B5DE5", "#FF8C42"];
  const teamColor = (t, i) => (/^#[0-9a-f]{3,8}$/i.test(t.color || "") ? t.color : TEAM_COLORS[i % TEAM_COLORS.length]);
  const grades = () => (Array.isArray(D().site.teams) ? D().site.teams : []).map((t, i) => ({ ...t, color: teamColor(t, i) }));
  WSG.teams = grades;
  const pageBySlug = (slug) => (D().pages || []).find((p) => p.slug === slug);
  function findSeries(id) {
    if (!id) return null;
    for (const c of D().committees) {
      const h = (c.highlights || []).find((h) => h.id === id);
      if (h) return { item: h, owner: c, link: `#/c/${c.slug}` };
    }
    const p = (D().pages || []).find((p) => p.id === id);
    if (p) return { item: p, owner: null, link: `#/p/${p.slug}` };
    return null;
  }
  const committeeLink = (c) => `#/c/${encodeURIComponent(c.slug)}`;
  const committeesOf = (pid) => D().committees.filter((c) => (c.memberIds || []).includes(pid));
  const chairLabel = (c) => (c.type === "class" ? "Class President" : "Chair");
  const vpsOf = (c) => (c.memberIds || []).map(person).filter((p) => p && p.id !== c.chairId && /vice president|^vp\b/i.test(p.title || ""));
  WSG.chairLabel = chairLabel;
  // "Assemblies Chair", "Junior Class Vice President", "Arketing Member"
  const groupName = (c) => c.name.replace(/\s+Committee$/i, "");
  const posLabel = (c, p) => {
    const role = p.id === c.chairId ? (c.type === "class" ? "President" : "Chair") : (p.title || "Member").replace(/^Class\s+/i, "");
    return `${groupName(c)} ${role}`;
  };

  /* ---------------- preset pictures ---------------- */
  const PRESET_KINDS = [
    ["volleyball", "Volleyball", /volleyball/i],
    ["basketball", "Basketball", /basketball/i],
    ["football", "Football", /football/i],
    ["soccer", "Soccer", /soccer/i],
    ["baseball", "Baseball", /baseball/i],
    ["softball", "Softball", /softball/i],
    ["tennis", "Tennis", /tennis/i],
    ["wrestling", "Wrestling", /wrestl/i],
    ["swim", "Swim", /swim|dive|diving/i],
    ["track", "Track", /track|cross country|\brun\b|5k/i],
    ["golf", "Golf", /golf/i],
    ["cheer", "Cheer & drill", /cheer|drill/i],
    ["christmas", "Christmas Jars", /christmas|jar|son of thor|muffin|gold rush|thunder trials/i],
    ["dance", "Dance", /dance|ballroom|\bball\b|prom|sadies|homecoming/i],
    ["concert", "Concert", /concert|band\b|choir|orchestra|madrigal|music|symphony/i],
    ["theater", "Theater", /show\b|musical|\bplay\b|theat|drama|one.?act/i],
    ["community", "Community", /community|festival|carnival|fair\b|parent|family|zero fatalities|service|breakfast/i],
    ["school", "Westlake bolt", /./],
  ];
  // Real photos (Unsplash, free to use; see assets/presets/photos/CREDITS.md), how many of each kind
  const PHOTO_COUNT = { volleyball: 2, basketball: 2, football: 2, soccer: 2, baseball: 2, softball: 1, tennis: 1, wrestling: 1, swim: 1, track: 2, golf: 1, cheer: 1, christmas: 1, dance: 2, concert: 2, theater: 2, community: 2 };
  const presetFiles = (k) =>
    PHOTO_COUNT[k] ? Array.from({ length: PHOTO_COUNT[k] }, (_, i) => `assets/presets/photos/${k}-${i + 1}.jpg`) : [`assets/presets/${k}-navy.svg`, `assets/presets/${k}-blue.svg`];
  const BUILTIN_PRESETS = PRESET_KINDS.flatMap(([k, label]) =>
    presetFiles(k).map((src, i, all) => ({ src, label: all.length > 1 ? `${label} ${i + 1}` : label, kind: k }))
  ).concat([  ]);
  WSG.presets = () => BUILTIN_PRESETS.concat((D().site.presets || []).filter((x) => x && x.src).map((x) => ({ ...x, kind: x.kind || "", custom: true })));
  WSG.presetKinds = () => PRESET_KINDS.map(([k, label]) => ({ k, label }));
  // Which presets events can get automatically: built-in ones unless switched off, added ones only if switched on
  const autoOn = (x) => {
    const o = (D().site.presetAuto || {})[x.src];
    return o == null ? !x.custom : !!o;
  };
  WSG.presetAutoOn = autoOn;
  const hashStr = (t) => [...String(t)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  // A matching preset picture for anything without a photo
  function autoPhoto(title, kind, id) {
    const k = kind || (PRESET_KINDS.find(([, , rx]) => rx.test(title || "")) || ["school"])[0];
    const on = WSG.presets().filter((x) => x.kind === k && autoOn(x)).map((x) => x.src);
    const files = on.length ? on : k === "school" ? presetFiles("school") : null;
    if (!files) return autoPhoto("", "school", id); // every picture for this kind is switched off
    return files[hashStr(id || title) % files.length]; // mixes the versions so a row of games doesn't look identical
  }
  const evPhoto = (e) => e.photo || autoPhoto(e.title, e.category, e.id);

  /* ---------------- school calendar events ---------------- */
  const normTitle = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/s$/, "");
  function schoolEvents() {
    const cfg = D().site.schoolCalendar || {};
    if (cfg.on === false) return [];
    const over = D().site.schoolOverrides || {};
    const mine = D().events.map((e) => normTitle(e.title)).filter((t) => t.length > 3);
    return ((WSG.school && WSG.school.events) || [])
      .filter((e) => !(over[e.id] && over[e.id].hide))
      .filter((e) => {
        const t = normTitle(e.title);
        return !mine.some((m) => t.includes(m) || m.includes(t));
      })
      .map((e) => ({
        ...e,
        ours: false,
        school: true,
        featured: false,
        committee: "",
        audiences: ["community", "students", "families"],
        photo: (over[e.id] && over[e.id].photo) || "",
        homeShow: (over[e.id] && over[e.id].homeShow) || "auto",
        photos: [],
        days: [],
      }));
  }
  const allEvents = () => D().events.concat(schoolEvents());
  WSG.allEvents = allEvents;
  WSG.schoolEventsRaw = () => (WSG.school && WSG.school.events) || [];

  // Which events go in "Coming up" on the home page
  function homePicks() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const days = (e) => {
      const d = toDate(String(nextOcc(e).start || "").slice(0, 10));
      return d && !isNaN(d) ? Math.round((d - now) / 864e5) : null;
    };
    // forced first, then anything today or tomorrow, then big events, then the rest by date
    const rank = (e) => (e.homeShow === "always" ? 0 : (days(e) ?? 99) <= 1 ? 1 : e.ours && e.featured ? 2 : 3);
    return allEvents()
      .filter((e) => !isPast(e) && e.homeShow !== "never")
      .filter((e) => {
        if (e.homeShow === "always") return true;
        const n = days(e);
        if (n == null) return false;
        if (!e.ours) return n <= 1; // promoted and school events: today or tomorrow only
        return n <= (e.featured ? 92 : 31); // big events 3 months ahead, the rest 1 month
      })
      .sort((a, b) => rank(a) - rank(b) || byStart(a, b))
      .slice(0, 6);
  }

  /* edit pins (only shown in edit mode) */
  WSG.pin = (target, label = "Edit") =>
    WSG.editMode ? `<button class="edit-pin" data-edit="${esc(target)}" type="button">✎ ${esc(label)}</button>` : "";
  const pin = WSG.pin;

  /* small message at the bottom of the screen */
  let flashTimer = 0;
  function flash(msg) {
    let el = $("#flash");
    if (!el) {
      el = document.createElement("div");
      el.id = "flash";
      el.className = "flash";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }
  WSG.flash = flash;

  /* ---------------- social icons ---------------- */
  const ICONS = {
    instagram: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none"/></svg>`,
    tiktok: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.6 2h-3.3v13.2a2.9 2.9 0 1 1-2.9-2.9c.3 0 .6 0 .9.1V9a6.3 6.3 0 1 0 5.3 6.2V8.6a7.6 7.6 0 0 0 4.4 1.4V6.7a4.4 4.4 0 0 1-4.4-4.4z"/></svg>`,
    youtube: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22 8.2a3 3 0 0 0-2.1-2.1C18 5.6 12 5.6 12 5.6s-6 0-7.9.5A3 3 0 0 0 2 8.2 31 31 0 0 0 1.6 12 31 31 0 0 0 2 15.8a3 3 0 0 0 2.1 2.1c1.9.5 7.9.5 7.9.5s6 0 7.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .4-3.8 31 31 0 0 0-.4-3.8zM10 15.2V8.8l5.2 3.2z"/></svg>`,
    facebook: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 8.5V6.8c0-.8.5-1 .9-1h2.4V2.1L14 2c-3.6 0-4.4 2.7-4.4 4.4v2.1H7.4v3.8h2.2V22H14v-9.7h3l.4-3.8z"/></svg>`,
    x: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.2-8.3L1.8 3h6.4l4.4 5.8zm-1.1 16.2h1.7L7.4 4.7H5.6z"/></svg>`,
    email: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/></svg>`,
    web: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>`,
  };
  const iconFor = (url) => {
    const u = String(url || "").toLowerCase();
    if (u.includes("instagram.com")) return ICONS.instagram;
    if (u.includes("tiktok.com")) return ICONS.tiktok;
    if (u.includes("youtube.com") || u.includes("youtu.be")) return ICONS.youtube;
    if (u.includes("facebook.com")) return ICONS.facebook;
    if (u.includes("twitter.com") || u.includes("x.com/")) return ICONS.x;
    if (u.startsWith("mailto:")) return ICONS.email;
    return ICONS.web;
  };
  // Every social link plus the contact email, as round icon buttons
  function socialIcons(cls = "") {
    const s = D().site;
    const list = (s.socials || []).filter((x) => x.url).map((x) => ({ url: safeUrl(x.url), label: x.label || "Link" }));
    if (s.contactEmail) list.push({ url: "mailto:" + s.contactEmail, label: "Email us" });
    if (!list.length) return "";
    return `<div class="soc ${cls}">${list.map((x) => `<a href="${esc(x.url)}" aria-label="${esc(x.label)}" title="${esc(x.label)}"${/instagram\.com/i.test(x.url) ? ' class="soc-ig"' : ""}>${iconFor(x.url)}</a>`).join("")}</div>`;
  }

  /* ---------------- nav + footer ---------------- */
  function renderChrome() {
    const s = D().site;
    $("#brandShort").textContent = s.short || "WSG";
    $("#brandSchool").textContent = s.school || "";
    // Page-change screen: the logo (W with lightning by default), or the short name if there's no logo
    const wl = s.wipeLogo === undefined ? "assets/img/w-logo.png" : s.wipeLogo;
    const want = wl ? imgSrc(wl) : "";
    const mk = $("#wipeMark");
    if (mk.dataset.src !== want) {
      mk.dataset.src = want;
      mk.innerHTML = want ? `<img src="${esc(want)}" alt="" decoding="async">` : esc(s.short || "WSG");
      mk.classList.toggle("has-logo", !!want);
    }
    $("#brandLogo").innerHTML = s.logo
      ? `<img src="${esc(imgSrc(s.logo))}" alt="">`
      : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2 5 14h6l-2 8 10-13h-6z" fill="currentColor"/></svg>`;
    document.title = s.name || "Student Government";
    const pages = (D().pages || []).filter((p) => p.inMenu);
    const links = [
      ["#/", "Home"],
      ["#/events", "Events"],
      ["#/committees", "Committees"],
      ["#/members", "Members"],
    ];
    const sub = D()
      .committees.map((c) => `<a href="${committeeLink(c)}">${esc(c.name)}</a>`)
      .join("");
    $("#navLinks").innerHTML =
      links
        .map(([h, t]) =>
          h === "#/committees"
            ? `<div class="nav-drop"><a href="${h}" data-nav aria-haspopup="true">${t}<span class="caret" aria-hidden="true">▾</span></a><div class="nav-sub"><a class="all" href="${h}">All committees</a>${sub}</div></div>`
            : `<a href="${h}" data-nav>${t}</a>`
        )
        .join("") + pages.map((p) => `<a href="#/p/${esc(p.slug)}" data-nav>${esc(p.title)}</a>`).join("") + socialIcons("soc-nav");

    renderAnnouncement();

    const socials = (s.socials || []).filter((x) => x.url);
    const connect = socials
      .map((x) => `<a href="${esc(safeUrl(x.url))}">${esc(x.label)}</a>`)
      .concat(s.contactEmail ? [`<a href="mailto:${esc(s.contactEmail)}">Email us</a>`] : [])
      .concat(s.suggestionUrl ? [`<a href="${esc(safeUrl(s.suggestionUrl))}">Share an idea</a>`] : []);
    $("#footer").innerHTML = `
      <div class="footer-stripe"></div>
      <div class="wrap footer-main">
        <div class="footer-brand">
          ${s.footerLogo ? `<img class="footer-wordmark" src="${esc(imgSrc(s.footerLogo))}" alt="${esc(s.school || "")}" loading="lazy">` : ""}
          <p class="footer-name">${esc(s.name || "")}</p>
          ${s.tagline ? `<p class="footer-tag">${esc(s.tagline)}</p>` : ""}
        </div>
        <div class="footer-col"><h4>Explore</h4>${links.map(([h, t]) => `<a href="${h}">${t}</a>`).join("")}${(D().pages || [])
          .map((p) => `<a href="#/p/${esc(p.slug)}">${esc(p.title)}</a>`)
          .join("")}</div>
        <div class="footer-col"><h4>Committees</h4>${D()
          .committees.map((c) => `<a href="${committeeLink(c)}">${esc(c.name)}</a>`)
          .join("")}</div>
        <div class="footer-col"><h4>Connect</h4>${connect.length ? connect.join("") : `<span>${esc(s.school || "")}</span>`}</div>
      </div>
      <div class="footer-bar"><div class="wrap">
        <span>© ${new Date().getFullYear()} ${esc(s.name || "")} · ${esc(s.school || "")}</span>
        <button class="edit-link" type="button" data-open-editor>${WSG.editMode ? "Editing" : "Edit site"}</button>
      </div></div>`;
  }
  /* announcement banner */
  const ANN_KEY = "wsg-announce-closed";
  const annSig = (a) => `${a.text}|${a.until}|${a.linkUrl}`;
  function annActive(a) {
    if (!a || !a.on || !String(a.text || "").trim()) return false;
    if (a.until) {
      const end = new Date(a.until + "T23:59:59");
      if (!isNaN(end) && Date.now() > end) return false;
    }
    return true;
  }
  function renderAnnouncement() {
    const box = $("#announce");
    if (!box) return;
    const a = D().site.announcement;
    let closed = false;
    try {
      closed = !WSG.editMode && a && localStorage.getItem(ANN_KEY) === annSig(a);
    } catch (_) {}
    if (!annActive(a) || closed) {
      box.hidden = true;
      box.innerHTML = "";
      return placeNav();
    }
    const url = a.linkUrl ? safeUrl(a.linkUrl) : "";
    box.innerHTML = `<div class="announce-in"><span class="announce-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M14 2 5 14h6l-2 8 10-13h-6z" fill="currentColor"/></svg></span><p>${esc(a.text)}</p>${
      url ? `<a class="announce-btn" href="${esc(url)}"${/^https?:/i.test(url) ? '' : ""}>${esc(a.linkLabel || "Learn more")} <span class="arr">→</span></a>` : ""
    }${WSG.editMode ? pin("banner", "Edit banner") : ""}</div><button class="announce-x" type="button" aria-label="Close announcement">&times;</button>`;
    box.hidden = false;
    $(".announce-x", box).addEventListener("click", () => {
      try {
        localStorage.setItem(ANN_KEY, annSig(a));
      } catch (_) {}
      if (hasGsap && !reduceMotion) gsap.to(box, { height: 0, paddingTop: 0, paddingBottom: 0, opacity: 0, duration: 0.35, ease: "power2.in", onUpdate: placeNav, onComplete: () => ((box.hidden = true), gsap.set(box, { clearProps: "all" }), placeNav()) });
      else (box.hidden = true), placeNav();
    });
    placeNav();
  }
  // The nav is fixed, so it sits under the banner until the banner scrolls away.
  function placeNav() {
    const box = $("#announce");
    const h = box && !box.hidden ? box.offsetHeight : 0;
    const off = Math.max(0, h - window.scrollY);
    document.documentElement.style.setProperty("--ann-off", off + "px");
  }
  window.addEventListener("resize", placeNav);

  function markActive(route) {
    $$("#navLinks a[data-nav]").forEach((a) => {
      const h = a.getAttribute("href");
      a.classList.toggle("active", h === "#/" ? route.name === "home" : h === "#/committees" ? route.name === "committees" || route.name === "committee" : location.hash.startsWith(h));
    });
  }

  /* ---------------- shared pieces ---------------- */
  /* Ideas form (one Google Form, shown on the home page and every committee page) */
  function formEmbed(url) {
    const u = safeUrl(url || "");
    const m = u.match(/^https:\/\/docs\.google\.com\/forms\/(?:u\/\d+\/)?d\/(e\/)?([\w-]+)/);
    if (!m) return "";
    return `https://docs.google.com/forms/d/${m[1] ? "e/" : ""}${m[2]}/viewform?embedded=true`;
  }
  /* ---------------- Get involved: ideas form + "Want to join?" ---------------- */
  // The ideas form is a Google Form filled in behind the scenes, so people never leave the site.
  // site.ideasForm.prefill holds the form's pre-filled link; its entry numbers are read in order:
  // 1 = what it's about, 2 = message, 3 = name, 4 = email.
  function ideasConfig() {
    const f = D().site.ideasForm || {};
    const link = String(f.prefill || "");
    const m = link.match(/^https:\/\/docs\.google\.com\/forms\/(?:u\/\d+\/)?d\/e\/([\w-]+)\//);
    const ids = [...link.matchAll(/entry\.(\d+)=/g)].map((x) => "entry." + x[1]);
    if (!f.on || !m || ids.length < 2) return null;
    return {
      action: `https://docs.google.com/forms/d/e/${m[1]}/formResponse`,
      ids,
      choices: String(f.choices || "").split("\n").map((x) => x.trim()).filter(Boolean).length
        ? String(f.choices).split("\n").map((x) => x.trim()).filter(Boolean)
        : ["An event idea", "A suggestion", "A question"],
      title: f.title || "What do you want to see student government do?",
      intro: f.intro || "Share an event idea, a suggestion or a question. It goes straight to student government.",
    };
  }
  function ideasCard(c) {
    const cfg = ideasConfig();
    if (!cfg) return WSG.editMode ? `<div class="talk-card talk-form-card">${pin("site:ideas", "Set up the ideas form")}<p class="muted">Paste the Google Form's pre-filled link in edit mode (Site & home).</p></div>` : "";
    const where = c ? c.name : "";
    return `<div class="talk-card talk-form-card rv">
      ${pin("site:ideas", "Edit the ideas form")}
      <div class="eyebrow">Have an idea?</div>
      <h3>${esc(cfg.title)}</h3>
      <p class="muted">${esc(cfg.intro)}</p>
      <form class="talk-form" data-where="${esc(where)}" novalidate>
        <fieldset class="talk-kinds"><legend class="sr">What is this about?</legend>${cfg.choices
          .map((ch, i) => `<label><input type="radio" name="kind" value="${esc(ch)}" ${i === 0 ? "checked" : ""}><span>${esc(ch)}</span></label>`)
          .join("")}</fieldset>
        <label class="talk-field"><span>Your message</span><textarea name="message" rows="4" maxlength="1500" required placeholder="${c ? `An idea for the ${esc(groupName(c))}…` : "I think it would be awesome if…"}"></textarea></label>
        <div class="talk-row">
          <label class="talk-field"><span>Name <small>(optional)</small></span><input name="name" maxlength="80" autocomplete="name"></label>
          <label class="talk-field"><span>Email <small>(optional, for a reply)</small></span><input name="email" type="email" maxlength="120" autocomplete="email"></label>
        </div>
        <input class="talk-hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
        <p class="talk-err" role="alert"></p>
        <button class="btn btn-gold talk-send" type="submit">Send <span class="arr">→</span></button>
      </form>
      <div class="talk-done" hidden><div class="talk-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></div><h3>Thanks! We got it.</h3><p class="muted">Student government reads every message.</p><button class="btn btn-line talk-again" type="button">Send another</button></div>
    </div>`;
  }
  function joinCard() {
    const j = D().site.join || {};
    if (!j.on || !(j.title || j.text)) return WSG.editMode ? `<div class="talk-card talk-join">${pin("site:join", "Add a \"Want to join?\" box")}</div>` : "";
    const who = person(j.contactId);
    return `<div class="talk-card talk-join rv">
      ${pin("site:join", "Edit this box")}
      <div class="join-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M14 2 5 14h6l-2 8 10-13h-6z" fill="currentColor"/></svg></div>
      <div class="eyebrow gold">Get involved</div>
      <h3>${esc(j.title || "Want to join?")}</h3>
      ${j.text ? paras(j.text) : ""}
      ${who ? `<div class="join-who"><span class="av">${img(who.photo, who.name, "")}</span><div><small>Questions? Talk to</small><b>${esc(who.name)}</b>${who.email ? `<a class="btn btn-gold" href="mailto:${esc(who.email)}">Email ${esc(who.name.split(" ")[0])} <span class="arr">→</span></a>` : ""}</div></div>` : ""}
    </div>`;
  }
  // Form first (above on phones), "Want to join?" beside it on computers
  function talkSection(c) {
    const a = ideasCard(c),
      b = joinCard();
    if (!a && !b) return "";
    return `<section class="section talk"><div class="wrap talk-grid ${a && b ? "" : "one"}">${a}${b}</div></section>`;
  }

  function evCard(ev, opts = {}) {
    const c = committee(ev.committee);
    const tags = (ev.audiences || []).map((a) => audience(a)).filter(Boolean);
    const past = isPast(ev);
    const link = ev.link && !past ? `<a class="ev-link" href="${esc(safeUrl(ev.link))}">${esc(ev.linkLabel || "Tickets & sign-up")} <span class="arr">→</span></a>` : "";
    return `<div class="ev-card rv ${opts.small ? "small" : ""} ${past ? "past" : ""} ${opts.cls || ""}" role="button" tabindex="0" data-event="${esc(ev.id)}">
      <div class="media">${dateBlock(ev)}${
        opts.small ? "" : ev.ours ? `<span class="badge-ours">${esc(D().site.short || "WSG")}</span>` : `<span class="badge-ours badge-promo">${ev.school ? "Westlake High" : "We're promoting"}</span>`
      }${happeningToday(ev) ? `<span class="today-tag">Today</span>` : ""}${img(evPhoto(ev), ev.title, ev.title)}</div>
      <div class="ev-body">
        <h3>${esc(ev.title)}</h3>
        <div class="ev-meta"><span>${esc(fmtWhen(ev))}</span>${ev.location ? `<span>${esc(ev.location)}</span>` : ""}${
          c && ev.ours ? `<span>Planned by ${esc(c.name)}</span>` : ""
        }</div>
        <div class="ev-tags">${tags.map((t) => `<span class="chip">${esc(t.label)}</span>`).join("")}${ev.cost ? `<span class="chip gold">${esc(ev.cost)}</span>` : ""}</div>
        ${link}
      </div>
    </div>`;
  }
  function miniEv(ev) {
    const s = toDate(ev.start);
    return `<button class="mini-ev" type="button" data-event="${esc(ev.id)}"><div class="d">${s && !isNaN(s) ? `${MONTHS[s.getMonth()]}<b>${s.getDate()}</b>` : "TBA"}</div><span>${esc(ev.title)}</span></button>`;
  }
  /* Past events: a button that opens a gallery of events that already happened.
     key "all" = every past event; otherwise only events that belong to that big event or special page. */
  const pastOf = (key) =>
    D()
      .events.filter((e) => isPast(e) && (key === "all" || e.series === key))
      .sort((a, b) => byStart(b, a));
  function pastBtn(key, cls = "btn-line") {
    if (key !== "all" && !pastOf(key).length) return "";
    return `<button class="btn ${cls}" type="button" data-past="${esc(key)}">View past events <span class="arr">→</span></button>`;
  }
  function openPast(key) {
    const list = pastOf(key);
    const s = findSeries(key);
    const title = key === "all" ? "Past events" : `Past ${s ? s.item.title : "events"}`;
    $("#modalCard").innerHTML = `
      <button class="modal-close" data-close aria-label="Close">&times;</button>
      <div class="m-body pe-body">
        <div class="eyebrow">Looking back</div>
        <h2 id="modalTitle">${esc(title)}</h2>
        ${
          list.length
            ? list
                .map((e) => {
                  const ph = (e.photos || []).filter((p) => p.src);
                  const when = toDate(e.start) && !isNaN(toDate(e.start)) ? fmtWhen(e) : "";
                  return `<article class="pe">
                    <div class="pe-head"><div><h3>${esc(e.title)}</h3>${when ? `<small>${esc(when)}</small>` : ""}</div>${pin("event:" + e.id, "Add photos")}</div>
                    ${e.description ? paras(e.description) : ""}
                    ${ph.length ? `<div class="gallery">${ph.map((p) => figure(p)).join("")}</div>` : `<p class="pe-none">Photos coming soon.</p>`}
                  </article>`;
                })
                .join("")
            : `<p class="muted">Photos from past events will show up here after they happen.</p>`
        }
      </div>`;
    showModal();
  }
  WSG.openPast = openPast;
  const figure = (p, label) =>
    `<figure data-lb="${esc(imgSrc(p.src, label))}" data-cap="${esc(p.caption || "")}">${img(p.src, p.caption || "", label)}${
      p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ""
    }</figure>`;
  const splitTitle = (t) =>
    esc(t)
      .split(/\s+/)
      .map((w) => `<span class="split-line"><span>${w}</span></span>`)
      .join(" ");
  function pageHero(title, lead, photo, opts = {}) {
    return `<section class="phero ${photo || opts.forcePhoto ? "" : "plain"}">
      ${photo || opts.forcePhoto ? `<div class="phero-media" data-parallax>${img(photo, "", title)}</div>` : ""}
      <div class="phero-inner">
        ${opts.kicker ? `<div class="eyebrow gold rv">${esc(opts.kicker)}</div>` : ""}
        <h1 class="ph-title">${splitTitle(title)}</h1>
        ${lead ? `<p class="lead rv">${esc(lead)}</p>` : ""}
        ${opts.after || ""}
      </div>
    </section>`;
  }

  // Special pages show on the home page always, never, or only between two months.
  function onHomeNow(p, def = "always") {
    const mode = p.homeMode || def;
    if (mode === "never") return false;
    if (mode === "always") return true;
    if (mode === "dates") {
      const now = Date.now();
      const a = p.homeStart ? new Date(p.homeStart + "T00:00:00") : null;
      const b = p.homeEnd ? new Date(p.homeEnd + "T23:59:59") : null;
      if (a && !isNaN(a) && now < a) return false;
      if (b && !isNaN(b) && now > b) return false;
      return true;
    }
    const m = new Date().getMonth() + 1;
    const a = Number(p.homeFrom) || 1,
      b = Number(p.homeTo) || 12;
    return a <= b ? m >= a && m <= b : m >= a || m <= b; // handles ranges that wrap past December
  }

  /* ---------------- pages ---------------- */
  function homePage() {
    const s = D().site;
    const words = (s.name || "Student Government").split(/\s+/);
    const last = words.pop();
    const picks = homePicks();
    const featured = picks.slice(0, 3);
    const more = picks.slice(3);
    const groups = D().committees;
    const statement = esc(s.intro || "")
      .split(/\s+/)
      .map((w) => `<span class="w">${w}</span>`)
      .join(" ");
    // Everything linked to the home page right now: special pages, committees and big events
    const promos = []
      .concat((D().pages || []).filter((p) => onHomeNow(p)).map((p) => ({ kicker: p.kicker, title: p.title, sub: p.subtitle, photo: p.photo, href: `#/p/${encodeURIComponent(p.slug)}`, edit: "page:" + p.id })))
      .concat(D().committees.filter((c) => onHomeNow(c, "never")).map((c) => ({ kicker: c.type === "class" ? "Class" : "Committee", title: c.name, sub: c.tagline, photo: c.photo, href: committeeLink(c), edit: "committee:" + c.id })))
      .concat(
        D().committees.flatMap((c) =>
          (c.highlights || []).filter((h) => onHomeNow(h, "never")).map((h) => ({ kicker: groupName(c), title: h.title, sub: h.summary, photo: h.photo || c.photo, href: committeeLink(c), edit: "committee:" + c.id }))
        )
      );
    const pastPhotos = (D().home.pastPhotos || []).slice(0, 12);
    const socials = (s.socials || []).filter((x) => x.url);

    return `
    <section class="hero">
      <div class="hero-media">${img(s.heroPhoto, s.heroCaption || "Student government group photo", "Whole council photo")}</div>
      ${s.heroCaption ? `<div class="hero-cap">${esc(s.heroCaption)}</div>` : ""}
      <div class="hero-inner">
        ${pin("site:hero", "Edit name and photo")}${pin("banner", "Announcement banner")}
        <h1>${words.map((w) => `<span class="line"><span>${esc(w)}</span></span>`).join("")}<span class="line"><span class="gold">${esc(last)}</span></span></h1>
        <div class="hero-sub"><p class="hero-tag">${esc(s.tagline || "")}</p><div class="scroll-cue"><i></i>Scroll</div></div>
      </div>
    </section>
    ${
      socialIcons()
        ? `<div class="soc-bar"><div class="wrap soc-bar-in">${pin("site:contact", "Edit socials")}<div class="soc-text"><span class="soc-label">Follow us</span><span class="soc-sub">Event updates, photos and more.</span></div>${socialIcons("soc-big")}</div></div>`
        : ""
    }

    ${s.intro ? `<section class="section white"><div class="wrap">${pin("site:intro")}<div class="mission-grid"><div><div class="eyebrow rv">Our mission</div><p class="statement" data-words>${statement}</p></div>${s.heroLogo ? `<div class="mission-logo rv">${img(s.heroLogo, "Westlake Thunder logo")}</div>` : ""}</div>${s.mission ? `<div class="mission rv">${paras(s.mission)}</div>` : ""}</div></section>` : ""}

    <section class="section blue">
      <div class="wrap">
        <div class="section-head"><div><div class="eyebrow gold rv">Don't miss it</div><h2 class="rv">Coming up</h2></div><div class="head-btns rv">${pastBtn("all")}<a class="btn btn-line" href="#/events">All events <span class="arr">→</span></a></div></div>
        ${pin("events", "Edit events")}
        ${
          featured.length
            ? `<div class="feature-list">${featured
                .map(
                  (e) => `<button class="feature rv" type="button" data-event="${esc(e.id)}">
              <div class="media">${happeningToday(e) ? `<span class="today-tag">Today</span>` : ""}${img(evPhoto(e), e.title, e.title)}</div>
              <div class="feature-body"><div class="feature-date">${esc(fmtWhen(e))}</div><h3>${esc(e.title)}</h3><p>${esc(e.description || "")}</p><span class="btn btn-gold" style="align-self:flex-start">Details <span class="arr">→</span></span></div>
            </button>`
                )
                .join("")}</div>`
            : `<div class="empty">New events are on the way.</div>`
        }
        ${more.length ? `<div class="ev-grid" style="margin-top:20px">${more.map((e) => evCard(e)).join("")}</div>` : ""}
      </div>
    </section>

    ${homeScores()}

    ${
      groups.length
        ? `<section class="rail-section" data-rail>
      <div class="rail-pin">
        <div class="rail-head"><div><div class="eyebrow gold">The teams behind it</div><h2>Committees</h2></div><a class="btn btn-line" href="#/committees">See all <span class="arr">→</span></a></div>
        <div class="rail">${groups
          .map(
            (c, i) => `<a class="rail-card" href="${committeeLink(c)}"><div class="media">${img(c.photo, c.name, c.name)}<div class="rail-card-text"><div class="rail-num">${String(i + 1).padStart(2, "0")}</div><h3>${esc(c.name)}</h3>${
              c.tagline ? `<p>${esc(c.tagline)}</p>` : ""
            }</div></div></a>`
          )
          .join("")}</div>
        <div class="rail-progress"><i></i></div>
      </div>
    </section>`
        : ""
    }

    ${
      pastPhotos.length
        ? `<section class="section"><div class="wrap">
      <div class="section-head"><div><div class="eyebrow rv">Looking back</div><h2 class="rv">Past events</h2></div></div>
      ${pin("home:photos", "Edit photos")}
      <div class="mosaic">${pastPhotos.map((p) => figure(p, "Past event photo")).join("")}</div>
    </div></section>`
        : WSG.editMode
        ? `<section class="section"><div class="wrap">${pin("home:photos", "Add past event photos")}</div></section>`
        : ""
    }

    ${promos
      .map(
        (p) => `<section class="band">
      <div class="band-media" data-parallax>${img(p.photo, p.title, p.title)}</div>
      <div class="band-inner">
        ${pin(p.edit, "Edit")}
        ${p.kicker ? `<div class="eyebrow gold rv">${esc(p.kicker)}</div>` : ""}
        <h2 class="rv">${esc(p.title)}</h2>
        ${p.sub ? `<p class="rv">${esc(p.sub)}</p>` : ""}
        <a class="btn btn-gold rv" href="${p.href}">Learn more <span class="arr">→</span></a>
      </div>
    </section>`
      )
      .join("")}

    ${talkSection()}`;
  }

  /* Events page */
  let evFilter = "all";
  function eventsPage() {
    const s = D().site;
    const auds = D().audiences;
    const chips = [`<button class="fchip ${evFilter === "all" ? "on" : ""}" data-filter="all">Everything</button>`]
      .concat(auds.map((a) => `<button class="fchip ${evFilter === a.id ? "on" : ""}" data-filter="${esc(a.id)}">${esc(a.label)}</button>`))
      .join("");
    return `${pageHero("Events", s.eventsIntro)}
      <div class="filters"><div class="wrap" role="toolbar" aria-label="Filter events by who they're for">${chips}</div></div>
      <section class="section tight"><div class="wrap" id="evList">${pin("events", "Edit events")}${eventsList()}</div></section>`;
  }
  function eventsList() {
    const all = allEvents().filter((e) => evFilter === "all" || (e.audiences || []).includes(evFilter));
    const up = all.filter((e) => !isPast(e)).sort(byStart);
    const past = all.filter((e) => isPast(e) && !e.school).sort((a, b) => byStart(b, a));
    const ours = up.filter((e) => e.ours);
    const other = up.filter((e) => !e.ours);
    const short = D().site.short || "WSG";
    const label = evFilter === "all" ? "" : ` for ${audience(evFilter) ? audience(evFilter).label.toLowerCase() : ""}`;
    return `
      <div class="ev-section"><div class="eyebrow">Planned by ${esc(short)}</div><h2>Our events</h2><p class="muted">Events student government is putting on${esc(label)}.</p>
        ${ours.length ? `<div class="ev-grid">${ours.map((e) => evCard(e)).join("")}</div>` : `<div class="empty">No upcoming events here yet.</div>`}</div>
      <div class="ev-section"><div class="eyebrow">Around Westlake</div><h2>Also happening</h2><p class="muted">Other school events we're promoting.</p>
        ${
          other.length
            ? `<div class="ev-grid ev-clip">${other.map((e, i) => evCard(e, { cls: i >= 9 ? "ev-extra" : "" })).join("")}</div>${
                other.length > 9 ? `<button class="btn btn-line ev-more-btn" type="button" data-showmore>Show all ${other.length} events <span class="arr">↓</span></button>` : ""
              }`
            : `<div class="empty">Nothing else on the calendar right now.</div>`
        }</div>
      ${
        past.length
          ? `<details class="ev-section past"><summary><h2>Past events</h2></summary><p class="muted">Photos from events that already happened.</p><div class="ev-grid">${past
              .map((e) => evCard(e))
              .join("")}</div></details>`
          : ""
      }`;
  }

  /* Committees overview */
  function committeesPage() {
    const s = D().site;
    const sbos = D().people.filter((p) => p.kind === "sbo");
    const advisers = D().people.filter((p) => p.kind === "adviser");
    const comms = D().committees;
    const jumps = [["sbos", "SBOs"]];
    comms.forEach((c) => jumps.push(["c-" + c.id, c.name.replace(/ Committee$/i, "")]));
    if (advisers.length) jumps.push(["advisers", "Advisors"]);
    const upcomingOf = (c) => D().events.filter((e) => e.committee === c.id && !isPast(e)).sort(byStart).slice(0, 3);
    const leaders = (c) => {
      const out = [];
      const sb = person(c.sboId);
      const ch = person(c.chairId);
      if (sb) out.push(leadPill(sb, sb.title || "SBO"));
      if (ch) out.push(leadPill(ch, posLabel(c, ch)));
      vpsOf(c).forEach((p) => out.push(leadPill(p, posLabel(c, p))));
      return out.length ? `<div class="leads">${out.join("")}</div>` : "";
    };
    const names = (ids) => {
      const ps = (ids || []).map(person).filter(Boolean);
      return ps.length ? `<ul class="names">${ps.map((p) => `<li>${esc(p.name || "Name")}</li>`).join("")}</ul>` : "";
    };
    return `${pageHero("Committees", s.committeesIntro)}
      <nav class="jump" aria-label="Jump to a committee"><div class="wrap">${jumps.map(([id, t]) => `<a href="#" data-jump="${esc(id)}">${esc(t)}</a>`).join("")}</div></nav>

      <section class="section blue group-block" id="sbos"><div class="wrap">
        ${pin("people:sbo", "Edit SBOs")}
        <div class="eyebrow gold rv">Student Body Officers</div>
        <h2 class="rv" style="font-size:clamp(48px,7vw,104px)">The SBOs</h2>
        <p class="lead rv">A student body president and five vice presidents lead student government. Each VP oversees a committee, and the president oversees the sophomore, junior and senior class committees.</p>
        <div class="group-photo rv">${media(s.sboGroupPhoto, "SBO group photo", "SBO group photo")}</div>
        <div class="sbo-row">${sbos.map((p) => `<div class="rv"><small>${esc(p.title || "Officer")}</small><b>${esc(p.name || "Name")}</b></div>`).join("")}</div>
      </div></section>

      <section class="section tight" style="padding-top:0"><div class="wrap">
        ${pin("committees", "Add or edit committees")}
        ${comms
          .map((c) => {
            const evs = upcomingOf(c);
            return `<article class="cblock" id="c-${esc(c.id)}">
            <div class="cblock-media rv">${media(c.photo, c.name, c.name)}</div>
            <div class="cblock-text">
              <div class="eyebrow rv">Committee</div>
              <h3 class="rv">${esc(c.name)}</h3>
              <div class="rv">${leaders(c)}</div>
              <p class="rv">${esc(c.tagline || "")}</p>
              <div class="rv">${names(c.memberIds)}</div>
              ${evs.length ? `<div class="cblock-events rv">${evs.map(miniEv).join("")}</div>` : ""}
              <a class="btn btn-navy rv" href="${committeeLink(c)}">Open ${esc(c.name)} <span class="arr">→</span></a>
            </div>
          </article>`;
          })
          .join("")}
      </div></section>

      ${
        advisers.length
          ? `<section class="section group-block" id="advisers" style="background:var(--white)"><div class="wrap">
        ${pin("people:adviser", "Edit advisors")}
        <div class="eyebrow rv">The adults in our corner</div>
        <h2 class="rv" style="font-size:clamp(48px,7vw,104px)">Advisors</h2>
        <div class="group-photo rv">${media(s.advisersGroupPhoto, "Advisors group photo", "Advisors group photo")}</div>
        <ul class="names" style="font-size:18px;margin-top:18px">${advisers.map((p) => `<li>${esc(p.name || "Name")}</li>`).join("")}</ul>
      </div></section>`
          : ""
      }
      ${talkSection()}`;
  }
  function leadPill(p, role) {
    return `<div class="lead-pill"><span class="av">${img(p.photo, p.name, "")}</span><span><small>${esc(role)}</small><b>${esc(p.name || "Name")}</b></span></div>`;
  }

  /* Single committee page */
  function committeePage(slug) {
    const c = D().committees.find((x) => x.slug === slug);
    if (!c) return notFound();
    const sb = person(c.sboId);
    const ch = person(c.chairId);
    const members = (c.memberIds || []).map(person).filter(Boolean);
    const up = D().events.filter((e) => e.committee === c.id && !isPast(e)).sort(byStart);
    const past = D().events.filter((e) => e.committee === c.id && isPast(e)).sort((a, b) => byStart(b, a)).slice(0, 6);
    const sbLine = sb ? `${sb.title || "SBO"}: ${sb.name}` : "";
    // this committee's big events, plus ones other committees share with it
    const hls = (c.highlights || []).map((h) => ({ h, owner: c })).concat(
      D().committees.filter((o) => o !== c).flatMap((o) => (o.highlights || []).filter((h) => (h.alsoOn || []).includes(c.id)).map((h) => ({ h, owner: o })))
    );
    return `${pageHero(c.name, c.tagline, c.photo, { kicker: "Committee", forcePhoto: true })}
      <section class="section"><div class="wrap">
        ${pin("committee:" + c.id, "Edit this committee")}
        <div class="c-intro">
          <div>
            <div class="eyebrow rv">What we do</div>
            <div class="c-desc rv">${paras(c.description)}</div>
            <div class="leads rv">${sb ? leadPill(sb, sb.title || "SBO") : ""}${ch ? leadPill(ch, posLabel(c, ch)) : ""}${vpsOf(c).map((p) => leadPill(p, posLabel(c, p))).join("")}</div>
          </div>
          <div class="member-list rv">
            <h3>Who's on it</h3>
            ${members.length ? `<ul>${members.map((p) => `<li>${esc(p.name || "Name")}<small>${esc(posLabel(c, p))}</small></li>`).join("")}</ul>` : `<p class="muted">Members coming soon.</p>`}
            ${sbLine ? `<p class="muted" style="margin:14px 0 0;font-size:14px">Overseen by ${esc(sbLine)}</p>` : ""}
          </div>
        </div>
        <div class="group-photo rv">${media(c.groupPhoto || c.photo, c.name + " group photo", "Committee group photo")}</div>
        ${members.length ? `<ul class="names rv" style="justify-content:center;margin-top:16px">${members.map((p) => `<li>${esc(p.name || "Name")}</li>`).join("")}</ul>` : ""}
      </div></section>

      ${
        c.theme
          ? `<section class="section blue tight"><div class="wrap" style="text-align:center">${pin("committee:" + c.id, "Edit theme")}<div class="eyebrow rv">${c.type === "class" ? "This year's " + esc(c.name.replace(/ Class$/i, "").toLowerCase()) + " theme" : "This year's theme"}</div><h2 class="rv" style="font-size:clamp(48px,9vw,140px);margin-top:10px">${esc(c.theme)}</h2></div></section>`
          : ""
      }
      ${scoreboard(c)}

      ${
        hls.length
          ? `<section class="section" style="padding-top:0"><div class="wrap hl">
        <div class="section-head"><div><div class="eyebrow rv">Our big events</div><h2 class="rv">Highlights</h2></div></div>
        ${hls
          .map(({ h, owner }) => {
            const next = D().events.filter((e) => e.series === h.id && !isPast(e)).sort(byStart)[0];
            return `<article class="hl-card rv" id="h-${esc(h.id)}">
            <div class="hl-top"><div class="media">${img(h.photo, h.title, h.title)}</div>
              <div class="hl-text"><div class="eyebrow gold">Big event</div><h3>${esc(h.title)}</h3><p>${esc(h.summary || "")}</p>
                ${next ? `<button class="btn btn-gold" style="align-self:flex-start" data-event="${esc(next.id)}">${esc(fmtWhen(next))} <span class="arr">→</span></button>` : ""}
              </div></div>
            ${pastBtn(h.id) ? `<div class="hl-past">${pastBtn(h.id, "btn-line light")}</div>` : ""}
            ${owner !== c ? `<p style="padding:0 clamp(20px,4vw,52px) 24px;margin:0;color:#C5D3E6;font-size:14px">Shared with <a href="${committeeLink(owner)}" style="color:var(--gold)">${esc(owner.name)}</a></p>` : ""}
          </article>`;
          })
          .join("")}
      </div></section>`
          : ""
      }

      <section class="section" style="background:var(--white)"><div class="wrap">
        <div class="section-head"><div><div class="eyebrow rv">On the calendar</div><h2 class="rv">Our events</h2></div><a class="btn btn-line rv" href="#/events">All events <span class="arr">→</span></a></div>
        ${up.length ? `<div class="ev-grid">${up.map((e) => evCard(e)).join("")}</div>` : `<div class="empty">New events coming soon.</div>`}
        ${past.length ? `<h3 style="font-size:36px;margin:48px 0 18px">Recently</h3><div class="ev-grid">${past.map((e) => evCard(e, { small: true })).join("")}</div>` : ""}
      </div></section>
      ${talkSection(c)}`;
  }

  function teamTotals(sb) {
    return grades().map((t) => ({ t, v: (sb.bowls || []).reduce((n, b) => n + (Number((b.scores || {})[t.id]) || 0), 0) }));
  }
  function niceMax(v) {
    if (v <= 0) return 100;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const k of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (k * p >= v * 1.08) return k * p;
    return 10 * p;
  }
  const CROWN = `<svg class="sg-crown" viewBox="0 0 64 44" aria-hidden="true"><path d="M4 14l14 12L32 4l14 22 14-12-6 26H10z" fill="#F5D46B" stroke="#B8902A" stroke-width="2.5" stroke-linejoin="round"/><circle cx="4" cy="13" r="4" fill="#F5D46B"/><circle cx="32" cy="4" r="4" fill="#F5D46B"/><circle cx="60" cy="13" r="4" fill="#F5D46B"/></svg>`;
  // Big vertical bar graph of the year's team totals
  function scoreGraph(sb) {
    const tots = teamTotals(sb).sort((a, b) => b.v - a.v);
    if (!tots.length) return `<div class="empty">Add teams in edit mode to start the scoreboard.</div>`;
    const top = tots[0].v;
    const max = niceMax(top);
    const ticks = [1, 0.75, 0.5, 0.25, 0].map((f) => Math.round(max * f));
    const played = (sb.bowls || []).filter((b) => Object.values(b.scores || {}).some((v) => Number(v) > 0)).length;
    const tied = tots.length > 1 && tots[1].v === top;
    const lead = tots.length > 1 && top > 0 && !tied ? `<b style="color:${tots[0].t.color}">${esc(tots[0].t.label)}</b> lead by ${(top - tots[1].v).toLocaleString()}` : top > 0 && tied ? "It's a tie at the top" : "No points yet";
    const cols = `repeat(${tots.length}, minmax(0, 1fr))`;
    return `<div class="sg">
      <div class="sg-meta"><span class="sg-live"><i></i>${played ? `After ${played} spirit bowl${played === 1 ? "" : "s"}` : "Season starting"}</span><span class="sg-lead">${lead}</span></div>
      <div class="sg-plot">
        <div class="sg-grid" aria-hidden="true">${ticks.map((t) => `<div><span>${t.toLocaleString()}</span></div>`).join("")}</div>
        <div class="sg-cols" style="grid-template-columns:${cols}">${tots
          .map((x, i) => {
            const leader = top > 0 && x.v === top;
            return `<div class="sg-col${leader ? " lead" : ""}" style="--c:${x.t.color}">
              <div class="sg-bar" data-h="${((x.v / max) * 100).toFixed(2)}" style="height:${((x.v / max) * 100).toFixed(2)}%" role="img" aria-label="${esc(x.t.label)}: ${x.v} points">
                <div class="sg-top">${leader ? CROWN : ""}<b data-count="${x.v}">${x.v.toLocaleString()}</b></div>
                <div class="sg-rank">${i + 1}</div>
              </div>
            </div>`;
          })
          .join("")}</div>
      </div>
      <div class="sg-labels" style="grid-template-columns:${cols}">${tots.map((x) => `<div style="--c:${x.t.color}"><i></i>${esc(x.t.label)}</div>`).join("")}</div>
    </div>`;
  }
  function scoreHost() {
    return D().committees.find((c) => c.scoreboard && c.scoreboard.enabled);
  }
  function homeScores() {
    const c = scoreHost();
    if (!c || D().home.showScores === false) return WSG.editMode ? `<section class="section"><div class="wrap">${pin("scores", "Turn on the spirit bowl standings")}</div></section>` : "";
    const sb = c.scoreboard;
    return `<section class="section score-band"><div class="wrap">
      ${pin("committee:" + c.id + ":score", "Edit scores")}${pin("scores", "Teams and colors")}
      <div class="section-head"><div><div class="eyebrow gold rv">This year's standings</div><h2 class="rv">${esc(sb.title || "Scoreboard")}</h2></div><a class="btn btn-line rv" href="${committeeLink(c)}">Full scoreboard <span class="arr">→</span></a></div>
      ${scoreGraph(sb)}
    </div></section>`;
  }

  function scoreboard(c) {
    const sb = c.scoreboard;
    if (!sb || !sb.enabled) return "";
    const gs = grades();
    const bowls = (sb.bowls || []).slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    return `<section class="section" style="padding-top:0"><div class="wrap">
      ${pin("committee:" + c.id + ":score", "Edit scores")}${pin("scores", "Teams and colors")}
      <div class="score rv">
        <div class="score-total score-band">
          <div class="eyebrow gold">This year's standings</div>
          <h3>${esc(sb.title || "Scoreboard")}</h3>
          ${sb.intro ? `<p style="color:#C5D3E6;max-width:720px;margin-top:14px">${esc(sb.intro)}</p>` : ""}
          ${scoreGraph(sb)}
        </div>
        <div class="bowls">${
          bowls.length
            ? bowls
                .map((b) => {
                  const best = Math.max(...gs.map((g) => Number((b.scores || {})[g.id]) || 0));
                  const d = toDate(b.date);
                  return `<div class="bowl"><div><div class="eyebrow">${d && !isNaN(d) ? `${MONTHS[d.getMonth()]} ${d.getDate()}` : ""}</div><h4>${esc(b.name)}</h4>${
                    b.description ? `<p class="muted" style="margin:6px 0 0">${esc(b.description)}</p>` : ""
                  }${(b.photos || []).length ? `<div class="gallery" style="margin-top:12px">${b.photos.map((p) => figure(p)).join("")}</div>` : ""}</div>
                  <div class="bowl-scores">${gs
                    .map((g) => {
                      const v = Number((b.scores || {})[g.id]) || 0;
                      return `<span class="${v === best && best > 0 ? "win" : ""}" style="--c:${g.color}"><b>${v}</b>${esc(g.label)}</span>`;
                    })
                    .join("")}</div></div>`;
                })
                .join("")
            : `<p class="muted">No results yet.</p>`
        }</div>
      </div>
    </div></section>`;
  }

  /* Members page */
  function membersPage() {
    const s = D().site;
    const sbos = D().people.filter((p) => p.kind === "sbo");
    const advisers = D().people.filter((p) => p.kind === "adviser");
    const students = D().people.filter((p) => p.kind === "student");
    const placed = new Set();
    const groups = D().committees
      .map((c) => {
        const ps = (c.memberIds || []).map(person).filter((p) => p && p.kind === "student");
        ps.forEach((p) => placed.add(p.id));
        return { c, ps };
      })
      .filter((g) => g.ps.length);
    const others = students.filter((p) => !placed.has(p.id));
    const card = (p, role, sbo) => `<article class="person rv">
      ${media(p.photo, p.name, "Headshot")}
      <div class="person-body">
        <div class="person-role">${esc(role)}</div>
        <h3>${esc(p.name || "Name")}</h3>
        ${p.bio ? `<p>${esc(p.bio)}</p>` : ""}
        ${sbo && p.duties ? `<div class="duties">${esc(p.duties)}</div>` : ""}
        ${p.email ? `<a class="person-ig person-email" href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : ""}
        ${p.instagram ? `<a class="person-ig" href="${esc(igUrl(p.instagram))}">Instagram @${esc(igHandle(p.instagram))} ↗</a>` : ""}
      </div>
    </article>`;
    return `${pageHero("Members", s.membersIntro)}
      <section class="section blue"><div class="wrap">
        ${pin("people:sbo", "Edit SBOs")}
        <div class="eyebrow gold rv">Student Body Officers</div>
        <h2 class="rv" style="font-size:clamp(48px,7vw,104px);margin-bottom:28px">The SBOs</h2>
        <div class="people sbo">${sbos
          .map((p) => {
            const over = D().committees.filter((c) => c.sboId === p.id).map((c) => c.name);
            const role = (p.title || "Officer") + (over.length ? ` · Over ${over.join(", ")}` : "");
            return card(p, role, true);
          })
          .join("")}</div>
      </div></section>
      <section class="section"><div class="wrap">
        ${pin("people:student", "Edit members")}
        ${groups
          .map(
            (g) => `<div class="mgroup"><h3 class="rv">${esc(g.c.name)} <a href="${committeeLink(g.c)}">View page →</a></h3><div class="people">${g.ps
              .map((p) => card(p, posLabel(g.c, p)))
              .join("")}</div></div>`
          )
          .join("")}
        ${others.length ? `<div class="mgroup"><h3 class="rv">Members</h3><div class="people">${others.map((p) => card(p, p.title || "Member")).join("")}</div></div>` : ""}
      </div></section>
      ${
        advisers.length
          ? `<section class="section" style="background:var(--white)"><div class="wrap">
        ${pin("people:adviser", "Edit advisors")}
        <div class="eyebrow rv">Advisors</div><h2 class="rv" style="font-size:clamp(48px,7vw,104px);margin-bottom:28px">Our advisors</h2>
        <div class="people">${advisers.map((p) => card(p, p.title || "Advisor")).join("")}</div>
      </div></section>`
          : ""
      }`;
  }
  const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const igHandle = (v) => String(v || "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/@?].*$/, "").replace(/^@/, "") || String(v).replace(/^@/, "");
  const igUrl = (v) => "https://instagram.com/" + encodeURIComponent(igHandle(v));

  /* Special page (Christmas Jars and any others) */
  function specialPage(slug) {
    const p = pageBySlug(slug);
    if (!p) return notFound();
    const t = (WSG.totals.pages || {})[p.slug];
    // Live total (from the donation link) plus any amount typed in by hand, like money raised through another link.
    const live = p.autoTotal && t && typeof t.raised === "number" ? t.raised : 0;
    const raised = live + (Number(p.manualRaised) || 0);
    const goal = Number(p.goal) || (t && t.goal) || 0;
    const pct = goal ? Math.min(100, (raised / goal) * 100) : 0;
    const updated = p.autoTotal && t && t.updated ? new Date(t.updated) : null;
    const up = D().events.filter((e) => e.series === p.id && !isPast(e)).sort(byStart);
    const money = (n) => "$" + Math.round(n).toLocaleString();
    return `${pageHero(p.title, p.subtitle, p.photo, { kicker: p.kicker, forcePhoto: true })}
      <section class="section tight" style="padding-top:0"><div class="wrap">
        ${
          p.showTotal
            ? `<div class="raise rv">
          ${pin("page:" + p.id, "Edit this page")}
          <div class="raise-nums"><div><div class="eyebrow">Raised so far</div><div class="raise-big" data-count="${raised}" data-money>${money(raised)}</div></div>${goal ? `<div class="raise-goal">of ${money(goal)} goal</div>` : ""}</div>
          <div class="raise-track"><div class="raise-fill" data-w="${pct}"></div></div>
          <div class="raise-foot"><small>${updated ? `Total last changed ${updated.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}</small>
            ${p.donateUrl ? `<a class="btn btn-gold" href="${esc(safeUrl(p.donateUrl))}">${esc(p.donateLabel || "Donate")} <span class="arr">→</span></a>` : ""}</div>
        </div>`
            : `${pin("page:" + p.id, "Edit this page")}`
        }
        ${countdowns(p)}
      </div></section>
      <section class="section" style="padding-top:clamp(24px,4vw,48px)"><div class="wrap">
        <div class="eyebrow rv">About</div>
        <div class="body-text rv">${paras(p.body)}</div>
        ${
          (!p.showTotal && p.donateUrl) || (p.links || []).some((l) => l.url) || pastBtn(p.id)
            ? `<div class="page-links rv">${!p.showTotal && p.donateUrl ? `<a class="btn btn-gold" href="${esc(safeUrl(p.donateUrl))}">${esc(p.donateLabel || "Donate")} <span class="arr">→</span></a>` : ""}${(p.links || [])
                .filter((l) => l.url)
                .map((l) => `<a class="btn btn-line" href="${esc(safeUrl(l.url))}">${esc(l.label || "Link")} <span class="arr">→</span></a>`)
                .join("")}${pastBtn(p.id)}</div>`
            : ""
        }
      </div></section>
      ${storySection(p)}
      ${waysSection(p, up.length)}
      ${up.length ? `<section class="section dark" id="pg-events"><div class="wrap"><div class="section-head"><div><div class="eyebrow gold rv">Coming up</div><h2 class="rv">Events</h2></div></div><div class="ev-grid">${up.map((e) => evCard(e)).join("")}</div></div></section>` : ""}
      ${
        (p.faq || []).some((f) => f.q)
          ? `<section class="section" style="background:var(--white)"><div class="wrap faq-wrap"><div><div class="eyebrow rv">Questions</div><h2 class="rv">Good to know</h2></div><div class="faq">${p.faq
              .filter((f) => f.q)
              .map((f) => `<details class="rv"><summary>${esc(f.q)}<span aria-hidden="true">+</span></summary><div>${paras(f.a || "")}</div></details>`)
              .join("")}</div></div></section>`
          : ""
      }`;
  }

  /* Christmas Jars extras (any special page can use them) */
  const daysUntil = (dateStr) => {
    const d = toDate(String(dateStr).slice(0, 10));
    if (!d || isNaN(d)) return null;
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return Math.round((d - t) / 864e5);
  };
  const longDate = (s) => {
    const d = toDate(String(s).slice(0, 10));
    return d && !isNaN(d) ? `${MONTH_FULL[d.getMonth()]} ${d.getDate()}` : "";
  };
  function countdowns(p) {
    const cards = [];
    if (p.lastDay) {
      const n = daysUntil(p.lastDay);
      if (n != null)
        cards.push(
          n >= 0
            ? `<div class="cd rv"><div class="cd-num" data-count="${n}">${n}</div><div><small>${n === 1 ? "Day" : "Days"} left to give</small><b>${n === 0 ? "Today is the last day!" : `Donations count through ${esc(longDate(p.lastDay))}`}</b></div></div>`
            : `<div class="cd rv done"><div class="cd-num">✓</div><div><small>Giving is closed</small><b>Thank you! Anything given now goes to next year.</b></div></div>`
        );
    }
    const big = D().events.find((e) => e.id === p.bigEventId);
    if (big && !isPast(big)) {
      const n = daysUntil(nextOcc(big).start);
      if (n != null && n >= 0)
        cards.push(`<button class="cd cd-big rv" type="button" data-event="${esc(big.id)}"><div class="cd-num"${n ? ` data-count="${n}"` : ""}>${n || "Today"}</div><div><small>Don't miss${n ? ` · ${n === 1 ? "day" : "days"} away` : ""}</small><b>${esc(big.title)}</b><span>${esc(fmtWhen(big))}</span></div></button>`);
    }
    return cards.length ? `<div class="cds">${cards.join("")}</div>` : "";
  }
  function storySection(p) {
    const st = p.story || {};
    const steps = (st.steps || []).filter((x) => x.label || x.text);
    if (!st.title && !st.text && !steps.length) return "";
    return `<section class="section story"><div class="wrap story-in">
      ${st.logo ? `<div class="story-logo rv">${img(st.logo, "Westlake Mighty Thunder logo")}</div>` : ""}
      <div>
        <div class="eyebrow gold rv">Our story</div>
        ${st.title ? `<h2 class="rv">${esc(st.title)}</h2>` : ""}
        ${st.text ? `<div class="rv story-text">${paras(st.text)}</div>` : ""}
        ${steps.length ? `<ol class="story-steps">${steps.map((x) => `<li class="rv"><b>${esc(x.label)}</b><p>${esc(x.text || "")}</p></li>`).join("")}</ol>` : ""}
      </div>
    </div></section>`;
  }
  function waysSection(p, hasEvents) {
    const w = p.ways || {};
    if (!w.on) return "";
    return `<section class="section ways"><div class="wrap">
      <div class="eyebrow rv">Give</div><h2 class="rv">${esc(w.title || "Two ways to give")}</h2>
      <div class="ways-grid">
        <div class="way rv"><span class="way-n">01</span><h3>${esc(w.onlineTitle || "Donate online")}</h3><p>${esc(w.onlineText || "")}</p>${p.donateUrl ? `<a class="btn btn-gold" href="${esc(safeUrl(p.donateUrl))}">${esc(p.donateLabel || "Donate")} <span class="arr">→</span></a>` : ""}</div>
        <div class="way rv"><span class="way-n">02</span><h3>${esc(w.eventTitle || "Come to an event")}</h3><p>${esc(w.eventText || "")}</p>${hasEvents ? `<button class="btn btn-navy" type="button" data-scrollto="pg-events">Find an event <span class="arr">→</span></button>` : ""}</div>
      </div>
    </div></section>`;
  }

  function notFound() {
    return `${pageHero("Not found", "That page doesn't exist anymore. It may have been renamed or removed.")}<section class="section"><div class="wrap"><a class="btn btn-navy" href="#/">Back home</a></div></section>`;
  }

  /* ---------------- event pop-up ---------------- */
  function allDates(ev) {
    const occ = occurrences(ev);
    if (occ.length < 2) return "";
    const now = new Date();
    return `<div class="m-dates"><small>All dates</small><span>${occ
      .map((o) => {
        const d = toDate(o.start);
        const gone = (dayEnd(o.end || o.start) || 0) < now;
        return `<i class="${gone ? "gone" : ""}">${DAYS[d.getDay()].slice(0, 3)}, ${MONTHS[d.getMonth()]} ${d.getDate()}</i>`;
      })
      .join("")}</span></div>`;
  }
  // Day-by-day activities for week-long events
  function schedule(ev) {
    const days = (ev.days || []).filter((x) => x && (x.date || x.title)).slice().sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
    if (!days.length) return "";
    return `<div class="sched"><h3>Day by day</h3>${days
      .map((x) => {
        const d = toDate(x.date);
        const ok = d && !isNaN(d);
        return `<div class="sched-row"><div class="sched-d">${ok ? `<small>${DAYS[d.getDay()].slice(0, 3)}</small><b>${d.getDate()}</b>` : "<b>–</b>"}</div><div><h4>${esc(x.title || "Activity coming soon")}</h4>${x.description ? `<p>${esc(x.description)}</p>` : ""}</div></div>`;
      })
      .join("")}</div>`;
  }
  WSG.schedule = schedule;

  function openEvent(id) {
    const ev = allEvents().find((e) => e.id === id);
    if (!ev) return;
    const c = committee(ev.committee);
    const tags = (ev.audiences || []).map(audience).filter(Boolean);
    const series = findSeries(ev.series);
    const photos = (ev.photos || []).filter((p) => p.src);
    const others = series ? pastOf(ev.series).filter((x) => x.id !== ev.id) : [];
    const pastYears = others.length ? `<div class="m-past"><h3>Past ${esc(series.item.title)}</h3><button class="btn btn-line" type="button" data-past="${esc(ev.series)}">View past events <span class="arr">→</span></button></div>` : "";
    $("#modalCard").innerHTML = `
      <button class="modal-close" data-close aria-label="Close">&times;</button>
      <div class="media m-media">${img(evPhoto(ev), ev.title, ev.title)}</div>
      <div class="m-body">
        <div class="eyebrow">${ev.ours ? (c ? esc(c.name) : esc(D().site.short)) : ev.school ? "From the Westlake High calendar" : "We're promoting"}</div>
        <h2 id="modalTitle">${esc(ev.title)}</h2>
        ${pin("event:" + ev.id, "Edit this event")}
        <div class="m-facts">
          <div><small>When</small><b>${esc(fmtWhen(ev))}</b></div>
          ${allDates(ev)}
          ${ev.location ? `<div><small>Where</small><b>${esc(ev.location)}</b></div>` : ""}
          ${ev.cost ? `<div><small>Cost</small><b>${esc(ev.cost)}</b></div>` : ""}
          ${ev.dressCode ? `<div><small>Dress code</small><b>${esc(ev.dressCode)}</b></div>` : ""}
          ${tags.length ? `<div><small>Who it's for</small><b>${tags.map((t) => esc(t.label)).join(", ")}</b></div>` : ""}
        </div>
        ${paras(ev.description)}
        ${schedule(ev)}
        <div class="m-actions">
          ${ev.link ? `<a class="btn btn-gold" href="${esc(safeUrl(ev.link))}">${esc(ev.linkLabel || "Tickets & sign-up")} <span class="arr">→</span></a>` : ""}
          ${!isPast(ev) && ev.start ? `<a class="btn btn-navy" href="${esc(gcalUrl(nextOcc(ev)))}">Add to Google Calendar</a><button class="btn btn-line" type="button" data-ics="${esc(ev.id)}">Apple / Outlook calendar</button>` : ""}
          ${c ? `<a class="btn btn-line" href="${committeeLink(c)}" data-close>${esc(c.name)}</a>` : ""}
        </div>
        ${photos.length ? `<div class="m-past"><h3>Photos</h3><div class="gallery">${photos.map((p) => figure(p)).join("")}</div></div>` : ""}
        ${pastYears}
      </div>`;
    showModal();
  }
  function showModal() {
    const m = $("#modal");
    const wasOpen = !m.hidden;
    m.hidden = false;
    $("#modalCard").scrollTop = 0;
    document.body.style.overflow = "hidden";
    if (!wasOpen) lastFocus = document.activeElement;
    $(".modal-close", m).focus();
    if (hasGsap && !reduceMotion) {
      if (!wasOpen) gsap.fromTo(".modal-backdrop", { opacity: 0 }, { opacity: 1, duration: 0.3 });
      gsap.fromTo("#modalCard", { y: 60, opacity: 0, scale: 0.97 }, { y: 0, opacity: 1, scale: 1, duration: 0.5, ease: "power3.out" });
    }
  }
  WSG.openEvent = openEvent;
  let lastFocus = null;
  function closeModal() {
    const m = $("#modal");
    if (m.hidden) return;
    m.hidden = true;
    document.body.style.overflow = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  WSG.closeModal = closeModal;

  const pad = (n) => String(n).padStart(2, "0");
  const calStamp = (d, allDay) =>
    allDay ? `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` : `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  function calRange(ev) {
    const allDay = ev.start.length <= 10;
    const s = toDate(ev.start);
    let e = toDate(ev.end);
    if (!e || isNaN(e) || e < s) e = new Date(s.getTime() + (allDay ? 864e5 : 36e5));
    else if (allDay || (ev.end && ev.end.length <= 10)) e = new Date(e.getTime() + 864e5);
    return { s, e, allDay };
  }
  function gcalUrl(ev) {
    const { s, e, allDay } = calRange(ev);
    const q = new URLSearchParams({ action: "TEMPLATE", text: ev.title, dates: `${calStamp(s, allDay)}/${calStamp(e, allDay)}`, details: ev.description || "", location: ev.location || "" });
    return "https://calendar.google.com/calendar/render?" + q.toString();
  }
  function downloadIcs(ev) {
    const { s, e, allDay } = calRange(ev);
    const clean = (t) => String(t || "").replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
    const prop = allDay ? ";VALUE=DATE" : "";
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Westlake Student Government//EN",
      "BEGIN:VEVENT",
      `UID:${ev.id}@wsg`,
      `DTSTAMP:${calStamp(new Date(), false)}`,
      `DTSTART${prop}:${calStamp(s, allDay)}`,
      `DTEND${prop}:${calStamp(e, allDay)}`,
      `SUMMARY:${clean(ev.title)}`,
      `LOCATION:${clean(ev.location)}`,
      `DESCRIPTION:${clean(ev.description)}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    a.download = ev.title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") + ".ics";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1000);
  }

  /* ---------------- animations ---------------- */
  let rafNav = 0,
    lastY = 0;
  function onScroll() {
    if (rafNav) return;
    rafNav = requestAnimationFrame(() => {
      rafNav = 0;
      const y = window.scrollY;
      placeNav();
      const nav = $("#nav");
      nav.classList.toggle("solid", y > 40);
      if (!document.body.classList.contains("nav-open")) nav.classList.toggle("hide", y > lastY && y > 300);
      // Sticky bars (committee jump bar, event filters) slide up into the space the menu leaves when it hides
      document.body.classList.toggle("nav-up", nav.classList.contains("hide"));
      lastY = y;
    });
  }

  function animate(first) {
    if (!hasGsap || reduceMotion) {
      $$("[data-w]").forEach((el) => (el.style.width = el.dataset.w + "%"));
      $$(".sg").forEach((g) => g.classList.add("done"));
      $$(".statement .w").forEach((w) => (w.style.opacity = 1));
      return;
    }
    ScrollTrigger.getAll().forEach((t) => t.kill());
    const main = $("#main");

    // Hero (home)
    const hero = $(".hero", main);
    if (hero) {
      const lines = $$("h1 .line>span", hero);
      gsap.fromTo(lines, { yPercent: 110 }, { yPercent: 0, duration: 1.1, ease: "power4.out", stagger: 0.09, delay: first ? 0.2 : 0.35 });
      gsap.fromTo($$(".hero-sub>*, .hero-cap", hero), { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.9, delay: first ? 0.7 : 0.8, stagger: 0.1 });
      const im = $(".hero-media img", hero);
      if (window.matchMedia("(max-width: 760px) and (orientation: portrait)").matches) {
        // Phones show the whole photo, so fade it in without zooming (zooming would crop people off the sides)
        gsap.fromTo(im, { opacity: 0 }, { opacity: 1, duration: 1.2 });
      } else {
        gsap.fromTo(im, { scale: 1.18 }, { scale: 1, duration: 1.8, ease: "power2.out" });
        gsap.to(im, { yPercent: 12, scale: 1.12, ease: "none", scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: SMOOTH } });
        gsap.to($(".hero-inner", hero), { yPercent: -30, opacity: 0.2, ease: "none", scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: SMOOTH } });
      }
    }
    // Page heroes
    $$(".phero", main).forEach((ph) => {
      gsap.fromTo($$(".ph-title .split-line>span", ph), { yPercent: 110 }, { yPercent: 0, duration: 1, ease: "power4.out", stagger: 0.08, delay: 0.3 });
      const im = $(".phero-media img", ph);
      if (im) {
        gsap.fromTo(im, { scale: 1.15 }, { scale: 1, duration: 1.6, ease: "power2.out" });
        gsap.to(im, { yPercent: 15, ease: "none", scrollTrigger: { trigger: ph, start: "top top", end: "bottom top", scrub: SMOOTH } });
      }
    });
    // Word-by-word statement
    $$("[data-words]", main).forEach((el) => {
      gsap.to($$(".w", el), { opacity: 1, stagger: 0.06, ease: "none", scrollTrigger: { trigger: el, start: "top 80%", end: "bottom 45%", scrub: SMOOTH } });
    });
    // Generic reveals
    ScrollTrigger.batch($$(".rv", main), {
      start: "top 88%",
      once: true,
      onEnter: (els) => gsap.to(els, { opacity: 1, y: 0, duration: 0.9, ease: "power3.out", stagger: 0.08, overwrite: true }),
    });
    // Photo zoom on scroll
    $$(".mosaic figure img, .cblock-media img, .hl-top .media img, .feature .media img", main).forEach((im) => {
      gsap.fromTo(im, { scale: 1.25 }, { scale: 1, ease: "none", scrollTrigger: { trigger: im.parentElement, start: "top bottom", end: "bottom top", scrub: SMOOTH } });
    });
    $$(".mosaic figure", main).forEach((f, i) => {
      gsap.fromTo(f, { opacity: 0, y: 60 }, { opacity: 1, y: 0, duration: 1, ease: "power3.out", delay: (i % 3) * 0.08, scrollTrigger: { trigger: f, start: "top 92%", once: true } });
    });
    // Parallax bands
    $$("[data-parallax]", main).forEach((el) => {
      if (el.closest(".phero") || isTouch) return;
      gsap.fromTo(el, { yPercent: -8 }, { yPercent: 8, ease: "none", scrollTrigger: { trigger: el.parentElement, start: "top bottom", end: "bottom top", scrub: SMOOTH } });
    });
    // Pinned horizontal rail (sticky scrolling section)
    const rs = $("[data-rail]", main);
    if (rs && window.matchMedia("(min-width: 761px)").matches) {
      const rail = $(".rail", rs);
      const dist = () => Math.max(0, rail.scrollWidth - window.innerWidth);
      if (dist() > 40) {
        gsap.to(rail, {
          x: () => -dist(),
          ease: "none",
          scrollTrigger: { trigger: rs, start: "top top", end: () => "+=" + dist(), pin: $(".rail-pin", rs), scrub: 0.6, invalidateOnRefresh: true, anticipatePin: 1 },
        });
        gsap.to($(".rail-progress i", rs), { scaleX: 1, ease: "none", scrollTrigger: { trigger: rs, start: "top top", end: () => "+=" + dist(), scrub: SMOOTH } });
      }
      gsap.fromTo($$(".rail-card", rs), { y: 80, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.07, duration: 1, ease: "power3.out", scrollTrigger: { trigger: rs, start: "top 70%", once: true } });
    }
    // "Follow us" icons pop in one by one
    const sb = $(".soc-bar", main);
    if (sb) {
      gsap.fromTo($$(".soc-big a", sb), { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.6, ease: "back.out(2.2)", stagger: 0.09, scrollTrigger: { trigger: sb, start: "top 92%", once: true } });
      gsap.fromTo($$(".soc-text > *", sb), { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: "power3.out", stagger: 0.08, scrollTrigger: { trigger: sb, start: "top 92%", once: true } });
    }
    // Spirit bowl graph: bars shoot up one by one, the crown drops onto the leader
    $$(".sg", main).forEach((g) => {
      const bars = $$(".sg-bar", g);
      bars.forEach((b) => (b.style.height = "0%"));
      gsap.set($$(".sg-crown", g), { y: -60, opacity: 0, rotate: -25 });
      gsap.set($$(".sg-labels>div", g), { y: 20, opacity: 0 });
      const tl = gsap.timeline({ scrollTrigger: { trigger: g, start: "top 78%", once: true } });
      tl.fromTo($$(".sg-grid>div", g), { opacity: 0, scaleX: 0 }, { opacity: 1, scaleX: 1, duration: 0.6, stagger: 0.05, ease: "power2.out" }, 0)
        .to($$(".sg-labels>div", g), { y: 0, opacity: 1, duration: 0.5, stagger: 0.08, ease: "back.out(2)" }, 0.1)
        .to(bars, { height: (i, el) => el.dataset.h + "%", duration: 1.5, ease: "expo.out", stagger: 0.14 }, 0.25)
        .to($$(".sg-crown", g), { y: 0, opacity: 1, rotate: 0, duration: 0.8, ease: "bounce.out" }, 1.4)
        .add(() => g.classList.add("done"), 1.6);
      $$(".sg-top b", g).forEach((el) => {
        const to = Number(el.dataset.count) || 0;
        const o = { v: 0 };
        el.textContent = "0";
        tl.to(o, { v: to, duration: 1.5, ease: "expo.out", onUpdate: () => (el.textContent = Math.round(o.v).toLocaleString()) }, 0.25 + bars.indexOf(el.closest(".sg-bar")) * 0.14);
      });
    });
    // Bars and counters
    $$("[data-w]", main).forEach((el) => {
      gsap.to(el, { width: el.dataset.w + "%", duration: 1.6, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 90%", once: true } });
    });
    $$("[data-count]", main).forEach((el) => {
      if (el.closest(".sg")) return;
      const to = Number(el.dataset.count) || 0;
      const money = el.hasAttribute("data-money");
      const o = { v: 0 };
      gsap.to(o, {
        v: to,
        duration: 1.8,
        ease: "power2.out",
        scrollTrigger: { trigger: el, start: "top 92%", once: true },
        onUpdate: () => (el.textContent = (money ? "$" : "") + Math.round(o.v).toLocaleString()),
      });
    });
    ScrollTrigger.refresh();
  }

  /* ---------------- router ---------------- */
  function parseRoute() {
    const h = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
    const [a, b] = h.split("/");
    if (!a) return { name: "home" };
    if (a === "events") return { name: "events" };
    if (a === "committees") return { name: "committees" };
    if (a === "members") return { name: "members" };
    if (a === "c" && b) return { name: "committee", slug: b };
    if (a === "p" && b) return { name: "page", slug: b };
    return { name: "notfound" };
  }
  function renderRoute(route) {
    switch (route.name) {
      case "home": return homePage();
      case "events": return eventsPage();
      case "committees": return committeesPage();
      case "members": return membersPage();
      case "committee": return committeePage(route.slug);
      case "page": return specialPage(route.slug);
      default: return notFound();
    }
  }
  let busy = false;
  let currentKey = "";
  function render(opts = {}) {
    const route = parseRoute();
    const key = location.hash;
    const keepScroll = opts.keepScroll;
    const y = window.scrollY;
    renderChrome();
    $("#main").innerHTML = renderRoute(route);
    markActive(route);
    currentKey = key;
    if (keepScroll) {
      window.scrollTo(0, y);
      $$(".rv", $("#main")).forEach((el) => {
        el.style.opacity = 1;
        el.style.transform = "none";
      });
    } else window.scrollTo(0, 0);
    animate(opts.first);
    if (keepScroll) $$(".rv").forEach((el) => gsap && gsap.set && hasGsap && gsap.set(el, { opacity: 1, y: 0 }));
    WSG.onRender.forEach((f) => f(route));
  }
  WSG.render = render;
  WSG.refresh = () => render({ keepScroll: true });

  function go() {
    if (location.hash === currentKey) return;
    document.body.classList.remove("nav-open");
    $("#navToggle").setAttribute("aria-expanded", "false");
    closeModal();
    if (!hasGsap || reduceMotion || busy) return render();
    // Timers (not the animation) decide when the new page renders, so a paused
    // animation (like a background tab) can never leave the old page stuck.
    busy = true;
    const w = $("#wipe");
    const mark = $("#wipeMark");
    gsap.killTweensOf([w, mark]);
    gsap.set(w, { y: 0, yPercent: 100, visibility: "visible" });
    gsap.to(w, { yPercent: 0, duration: 0.5, ease: "power4.inOut" });
    gsap.fromTo(mark, { opacity: 0, y: 30, scale: 0.86 }, { opacity: 1, y: 0, scale: 1, duration: 0.42, delay: 0.26, ease: "back.out(1.8)" });
    setTimeout(() => {
      render();
      gsap.to(mark, { opacity: 0, y: -24, scale: 1.04, duration: 0.25 });
      gsap.to(w, { yPercent: -100, duration: 0.6, ease: "power4.inOut", delay: 0.15, onComplete: () => gsap.set(w, { visibility: "hidden" }) });
      setTimeout(() => {
        busy = false;
        gsap.set(w, { visibility: "hidden", yPercent: 100 }); // never leave the cover on screen
      }, 1000);
    }, 620);
  }

  /* ---------------- events ---------------- */
  document.addEventListener("click", (e) => {
    const t = e.target;
    const more = t.closest("[data-showmore]");
    if (more) {
      more.previousElementSibling.classList.add("open");
      more.remove();
      return;
    }
    // Email links just copy the address (no email app opens)
    const mail = t.closest('a[href^="mailto:"]');
    if (mail && !t.closest(".edit-pin")) {
      e.preventDefault();
      const addr = decodeURIComponent(mail.getAttribute("href").slice(7).split("?")[0]);
      const done = () => flash(`Email copied: ${addr}`);
      const oldWay = () => {
        // Older phones: copy through a hidden text box
        const ta = document.createElement("textarea");
        ta.value = addr;
        ta.setAttribute("readonly", "");
        ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, addr.length);
        let ok = false;
        try {
          ok = document.execCommand("copy");
        } catch (_) {}
        ta.remove();
        ok ? done() : flash(addr);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(addr).then(done, oldWay);
      else oldWay();
      return;
    }
    const sc = t.closest("[data-scrollto]");
    if (sc) {
      const el = document.getElementById(sc.dataset.scrollto);
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 70, behavior: reduceMotion ? "auto" : "smooth" });
      return;
    }
    const pastB = t.closest("[data-past]");
    if (pastB && !t.closest(".edit-pin")) {
      e.preventDefault();
      return openPast(pastB.dataset.past);
    }
    const evBtn = t.closest("[data-event]");
    if (evBtn && !t.closest(".edit-pin") && !t.closest("a.ev-link")) {
      e.preventDefault();
      return openEvent(evBtn.dataset.event);
    }
    if (t.closest("[data-close]")) {
      const link = t.closest("a[data-close]");
      closeModal();
      if (!link) e.preventDefault();
      return;
    }
    const f = t.closest("[data-filter]");
    if (f) {
      evFilter = f.dataset.filter;
      $$(".fchip").forEach((c) => c.classList.toggle("on", c === f));
      $("#evList").innerHTML = pin("events", "Edit events") + eventsList();
      animate(false);
      return;
    }
    const j = t.closest("[data-jump]");
    if (j) {
      e.preventDefault();
      const target = document.getElementById(j.dataset.jump);
      if (target) window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - 130, behavior: reduceMotion ? "auto" : "smooth" });
      $$(".jump a").forEach((a) => a.classList.toggle("on", a === j));
      return;
    }
    const yb = t.closest("[data-year]");
    if (yb) {
      const box = yb.closest("[data-years]");
      $$("[data-year]", box).forEach((b) => {
        b.classList.toggle("on", b === yb);
        b.setAttribute("aria-selected", b === yb);
      });
      $$("[data-panel]", box).forEach((p) => (p.hidden = p.dataset.panel !== yb.dataset.year));
      return;
    }
    const lb = t.closest("[data-lb]");
    if (lb) {
      $("#lbImg").src = lb.dataset.lb;
      $("#lbCap").textContent = lb.dataset.cap || "";
      $("#lightbox").hidden = false;
      return;
    }
    if (t.closest("[data-lbclose]") || t.id === "lightbox") return ($("#lightbox").hidden = true);
    const ics = t.closest("[data-ics]");
    if (ics) {
      const ev = allEvents().find((x) => x.id === ics.dataset.ics);
      if (ev) downloadIcs(ev);
      return;
    }
    if (t.closest("#navToggle")) {
      const open = document.body.classList.toggle("nav-open");
      $("#navToggle").setAttribute("aria-expanded", String(open));
      $("#nav").classList.remove("hide");
      return;
    }
    if (t.closest("#navLinks a")) {
      document.body.classList.remove("nav-open");
    }
  });
  document.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches("div[data-event]")) {
      e.preventDefault();
      return openEvent(e.target.dataset.event);
    }
    if (e.key === "Escape") {
      if (!$("#lightbox").hidden) return ($("#lightbox").hidden = true);
      closeModal();
      document.body.classList.remove("nav-open");
    }
  });
  window.addEventListener("hashchange", go);
  document.addEventListener("submit", async (e) => {
    const form = e.target.closest && e.target.closest(".talk-form");
    if (!form) return;
    e.preventDefault();
    const cfg = ideasConfig();
    const card = form.closest(".talk-card");
    const err = $(".talk-err", form);
    const btn = $(".talk-send", form);
    const v = (n) => (form.elements[n] ? form.elements[n].value.trim() : "");
    err.textContent = "";
    if (v("website")) return; // filled in by spam bots only
    if (!v("message")) return (err.textContent = "Type a message first."), form.elements.message.focus();
    if (v("email") && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v("email"))) return (err.textContent = "That email doesn't look right. You can also leave it blank.");
    if (!cfg) return (err.textContent = "The form isn't set up yet.");
    const kind = (form.querySelector('input[name="kind"]:checked') || {}).value || cfg.choices[0];
    const where = form.dataset.where;
    const values = [kind, (where ? `[${where} page] ` : "") + v("message"), v("name"), v("email")];
    const body = new URLSearchParams();
    cfg.ids.forEach((id, i) => values[i] != null && values[i] !== "" && body.append(id, values[i]));
    btn.disabled = true;
    btn.innerHTML = "Sending…";
    try {
      // Google doesn't let other sites read its reply, so a finished request counts as sent
      await fetch(cfg.action, { method: "POST", mode: "no-cors", body });
      form.hidden = true;
      $(".talk-done", card).hidden = false;
      if (hasGsap && !reduceMotion) gsap.fromTo($(".talk-done", card), { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" });
      form.reset();
    } catch (_) {
      err.textContent = "Couldn't send. Check your internet connection and try again.";
    }
    btn.disabled = false;
    btn.innerHTML = 'Send <span class="arr">→</span>';
  });
  document.addEventListener("click", (e) => {
    const again = e.target.closest && e.target.closest(".talk-again");
    if (!again) return;
    const card = again.closest(".talk-card");
    $(".talk-done", card).hidden = true;
    $(".talk-form", card).hidden = false;
    $("textarea", card).focus();
  });
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#/"]');
    if (a && a.getAttribute("href") === (location.hash || "#/")) {
      e.preventDefault();
      document.body.classList.remove("nav-open");
      window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    }
  });
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---------------- boot ---------------- */
  async function getJson(path) {
    const r = await fetch(path + "?v=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error(path + " " + r.status);
    return r.json();
  }
  WSG.ready = (async () => {
    try {
      WSG.data = await getJson("data/site.json");
    } catch (err) {
      $("#main").innerHTML = `<section class="section"><div class="wrap"><h1 style="font-size:64px;margin-top:80px">Loading problem</h1><p class="lead">The site's content couldn't load. Try refreshing the page.</p></div></section>`;
      throw err;
    }
    try {
      WSG.totals = await getJson("data/total.json");
    } catch (_) {
      WSG.totals = { pages: {} };
    }
    try {
      WSG.school = await getJson("data/school-events.json");
    } catch (_) {
      WSG.school = { events: [] };
    }
    if (window.WSGEditor && WSGEditor.restoreDraft) WSGEditor.restoreDraft();
    render({ first: true });
    onScroll();
  })();
})();
