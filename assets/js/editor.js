/* Westlake Student Government: edit mode.
   Passcodes unlock a GitHub key (stored encrypted in data/auth.json). Changes are saved
   straight into the site's GitHub repository, and GitHub Pages updates the live site. */
(function () {
  "use strict";
  const WSG = window.WSG;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => WSG.esc(s);
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const SESSION_KEY = "wsg-session";
  const DRAFT_KEY = "wsg-draft";
  const TEST_KEY = "wsg-test-published";
  const API = "https://api.github.com";

  const Ed = (window.WSGEditor = {});
  let session = null; // {role, owner, repo, branch, token, test}
  let baseSha = null; // sha of data/site.json when editing started
  let dirty = false;
  let view = { tab: "site", id: null };
  const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
  const slugify = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "page-" + uid().slice(0, 4);
  const isAdviser = () => session && session.role === "adviser";

  /* ================= crypto (passcode -> GitHub key) ================= */
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  async function deriveKey(pass, salt) {
    const base = await crypto.subtle.importKey("raw", enc.encode(pass.trim()), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
  }
  async function lock(secret, pass) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(pass, salt);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(secret)));
    return { salt: b64(salt), iv: b64(iv), ct: b64(ct) };
  }
  async function unlock(box, pass) {
    try {
      const key = await deriveKey(pass, unb64(box.salt));
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(box.iv) }, key, unb64(box.ct));
      return JSON.parse(dec.decode(pt));
    } catch (_) {
      return null;
    }
  }
  const utf8b64 = (str) => {
    const bytes = enc.encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };

  /* ================= storage: GitHub or local test ================= */
  async function gh(method, path, body, s = session) {
    const r = await fetch(`${API}/repos/${s.owner}/${s.repo}${path}`, {
      method,
      headers: { Authorization: `Bearer ${s.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 404 && method === "GET") return null;
    if (!r.ok) {
      let msg = r.status + "";
      try {
        msg = (await r.json()).message || msg;
      } catch (_) {}
      const err = new Error(msg);
      err.status = r.status;
      throw err;
    }
    return r.status === 204 ? {} : r.json();
  }
  const store = {
    async sha(path) {
      if (session.test) return localStorage.getItem("wsg-test-sha") || "local";
      const f = await gh("GET", `/contents/${path}?ref=${encodeURIComponent(session.branch)}`);
      return f ? f.sha : null;
    },
    async put(path, base64, message, sha) {
      if (session.test) {
        // Local preview: save straight into the site folder when the preview server allows it.
        try {
          const r = await fetch("__save", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, content: base64 }) });
          if (r.ok) {
            if (path === "data/site.json") localStorage.removeItem(TEST_KEY);
            return { content: { sha: "disk-" + Date.now() } };
          }
        } catch (_) {}
        if (path === "data/site.json") {
          localStorage.setItem(TEST_KEY, decodeURIComponent(escape(atob(base64))));
          const n = "local-" + Date.now();
          localStorage.setItem("wsg-test-sha", n);
          return { content: { sha: n } };
        }
        return { content: { sha: "local" } }; // images stay in memory in test mode
      }
      const body = { message, content: base64, branch: session.branch };
      if (sha) body.sha = sha;
      return gh("PUT", `/contents/${path}`, body);
    },
  };

  /* ================= session + drafts ================= */
  function saveSession() {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...session, baseSha }));
    } catch (_) {}
  }
  function loadSession() {
    try {
      const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
      if (s && s.role) {
        baseSha = s.baseSha || null;
        delete s.baseSha;
        return s;
      }
    } catch (_) {}
    return null;
  }
  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ data: WSG.data, baseSha, time: Date.now() }));
    } catch (_) {}
  }
  function clearDraft() {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch (_) {}
  }
  Ed.restoreDraft = function () {
    if (isLocal) {
      try {
        const t = localStorage.getItem(TEST_KEY);
        if (t) WSG.data = JSON.parse(t);
      } catch (_) {}
    }
    session = loadSession();
    if (!session) return;
    WSG.editMode = true;
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if (d && d.data) {
        WSG.data = d.data;
        dirty = true;
      }
    } catch (_) {}
    setTimeout(() => {
      buildShell();
      updateBar();
    }, 0);
  };

  /* ================= change tracking ================= */
  let refreshTimer = 0;
  function changed(opts = {}) {
    dirty = true;
    saveDraft();
    updateBar();
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => WSG.refresh(), opts.now ? 0 : 450);
  }

  /* ================= field schemas ================= */
  const D = () => WSG.data;
  const opt = (v, l) => ({ v, l });
  const committeeOpts = () => [opt("", "None (not a committee event)")].concat(D().committees.map((c) => opt(c.id, c.name)));
  const peopleOpts = (kind) =>
    [opt("", "Nobody yet")].concat(D().people.filter((p) => !kind || p.kind === kind).map((p) => opt(p.id, (p.name || "Unnamed") + (p.title ? " · " + p.title : ""))));
  const seriesOpts = () => {
    const out = [opt("", "None")];
    D().committees.forEach((c) => (c.highlights || []).forEach((h) => out.push(opt(h.id, `${h.title} (${c.name})`))));
    (D().pages || []).forEach((p) => out.push(opt(p.id, `${p.title} (special page)`)));
    return out;
  };
  const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const monthOpts = () => MONTH_NAMES.map((m, i) => opt(String(i + 1), m));
  const YEAR_FIELDS = [
    { k: "year", t: "text", l: "Year", max: 12, ph: "2026" },
    { k: "theme", t: "text", l: "Theme (optional)", max: 60, hint: "Only if there was one. Leave blank otherwise." },
    { k: "description", t: "textarea", l: "What happened / details" },
    { k: "photos", t: "images", l: "Photos" },
  ];
  // "Show on the home page" settings, shared by special pages, committees and big events
  const homeFields = (def) => [
    { k: "homeMode", t: "select", l: "Show on the home page", hint: "Adds a big photo band with a button to this page.", opts: () => [opt("never", "Never"), opt("always", "Always"), opt("months", "Certain months every year"), opt("dates", "Between two dates")], dflt: def },
    { k: "homeFrom", t: "select", l: "From", opts: monthOpts, showIf: (o) => o.homeMode === "months" },
    { k: "homeTo", t: "select", l: "Through", opts: monthOpts, showIf: (o) => o.homeMode === "months" },
    { k: "homeStart", t: "date", l: "Start showing on", showIf: (o) => o.homeMode === "dates" },
    { k: "homeEnd", t: "date", l: "Stop showing after", hint: "It comes off the home page on its own after this day.", showIf: (o) => o.homeMode === "dates" },
  ];
  const yearsField = { k: "years", t: "list", l: "Years", hint: "Newest year shows first.", item: "year", title: (y) => y.year || "New year", fields: YEAR_FIELDS, make: () => ({ id: uid(), year: String(new Date().getFullYear()), theme: "", description: "", photos: [] }) };

  const S = {
    site: [
      { k: "name", t: "text", l: "Site name (big title on the home page)", max: 40 },
      { k: "short", t: "text", l: "Short name", max: 6, hint: "Shown in the menu and footer, like WSG." },
      { k: "school", t: "text", l: "School name", max: 40 },
      { k: "tagline", t: "text", l: "Tagline under the title", max: 90 },
      { k: "logo", t: "image", l: "Menu logo (top left)", hint: "Shown on a white badge.", png: true, max: 400 },
      { k: "heroLogo", t: "image", l: "Logo next to the mission statement", png: true, max: 900 },
      { k: "footerLogo", t: "image", l: "Logo at the bottom of every page", png: true, max: 900 },
      { k: "heroPhoto", t: "image", l: "Whole council photo (home page)", hint: "Use a wide (landscape) photo." },
      { k: "heroCaption", t: "text", l: "Photo caption", max: 60 },
      { k: "intro", t: "textarea", l: "Big mission statement", max: 260, hint: "One or two sentences. Shown big on the home page." },
      { k: "mission", t: "textarea", l: "Full mission statement", hint: "Shown under the big statement on the home page." },
      { k: "contactEmail", t: "email", l: "Contact email" },
      { k: "suggestionUrl", t: "url", l: "Ideas form (Google Form link)", hint: "Shown at the bottom of the home page and every committee page. In Google Forms, click Send, pick the link tab, and paste the full link (not the shortened one) so the form shows right on the page." },
      { k: "ideasTitle", t: "text", l: "Ideas section title", max: 70, ph: "What do you want to see student government do?" },
      { k: "ideasIntro", t: "text", l: "Ideas section line under the title", max: 120, ph: "Tell us. We read every one." },
      { k: "socials", t: "list", l: "Social media links", item: "link", title: (x) => x.label || "New link", fields: [{ k: "label", t: "text", l: "Name (like Instagram)", max: 20 }, { k: "url", t: "url", l: "Link" }], make: () => ({ label: "", url: "" }) },
      {
        k: "join",
        t: "group",
        l: "\"Want to join?\" section",
        fields: [
          { k: "on", t: "check", l: "Show it on the home and committees pages" },
          { k: "title", t: "text", l: "Title", max: 50, ph: "Want to join student government?" },
          { k: "text", t: "textarea", l: "Text", max: 400 },
          { k: "contactId", t: "select", l: "Who to talk to", opts: () => peopleOpts() },
        ],
      },
      { k: "eventsIntro", t: "textarea", l: "Events page intro", max: 200 },
      { k: "committeesIntro", t: "textarea", l: "Committees page intro", max: 220 },
      { k: "membersIntro", t: "textarea", l: "Members page intro", max: 200 },
      { k: "sboGroupPhoto", t: "image", l: "SBO group photo (committees page)" },
      { k: "advisersGroupPhoto", t: "image", l: "Advisors group photo (committees page)" },
    ],
    home: [{ k: "pastPhotos", t: "images", l: "Past event photos on the home page", hint: "The first 12 show. Add a caption to each." }],
    event: [
      { k: "title", t: "text", l: "Event name", max: 50 },
      { k: "ours", t: "check", l: "Planned by student government", hint: "Unchecked means it's an event we're promoting, like a game. It shows under \"Also happening\"." },
      { k: "featured", t: "check", l: "Big event", hint: "Big events (like prom or homecoming) show on the home page up to 3 months ahead. Other events show 1 month ahead." },
      { k: "homeShow", t: "select", l: "Home page", hint: "Automatic follows the rules above, and the best 6 show. Always or Never overrides that.", opts: () => [opt("auto", "Automatic"), opt("always", "Always show"), opt("never", "Never show")], dflt: "auto" },
      { k: "start", t: "datetime", l: "Starts", hint: "For a week-long event, pick the first day here and the last day under Ends." },
      { k: "end", t: "datetime", l: "Ends (optional)" },
      { k: "timeNote", t: "text", l: "Time in words (optional)", max: 40, ph: "Lunch, After 2nd period…", hint: "Use this instead of a clock time, like \"Lunch\". Shows in place of the times above." },
      { k: "moreDates", t: "list", l: "More dates (optional)", hint: "For events that happen on several separate days, like every Monday. Same times as the first date.", item: "date", title: (x) => x.date || "New date", fields: [{ k: "date", t: "date", l: "Date" }], make: () => ({ date: "" }) },
      { k: "days", t: "list", l: "Day-by-day schedule (optional)", hint: "For week-long events like Spirit Week. One activity per day.", item: "day", title: (x) => (x.date ? x.date + " · " : "") + (x.title || "Activity coming soon"), fields: [{ k: "date", t: "date", l: "Day" }, { k: "title", t: "text", l: "Activity", max: 50, ph: "Pajama Day" }, { k: "description", t: "textarea", l: "Details (optional)", max: 200 }], make: () => ({ id: uid(), date: "", title: "", description: "" }) },
      { k: "done", t: "check", l: "This already happened", hint: "Moves it to past events even without a date." },
      { k: "location", t: "text", l: "Location", max: 60 },
      { k: "audiences", t: "multi", l: "Who it's for", opts: () => D().audiences.map((a) => opt(a.id, a.label)) },
      { k: "committee", t: "select", l: "Committee planning it", opts: committeeOpts },
      { k: "description", t: "textarea", l: "Description" },
      { k: "cost", t: "text", l: "Cost", max: 40, ph: "Free, $5, $10 at the door…" },
      { k: "dressCode", t: "text", l: "Dress code (optional)", max: 50 },
      { k: "link", t: "url", l: "Link for this event (optional)", hint: "Tickets, a donation page, a sign-up form, anything. Shows as a button on the event card and in its pop-up." },
      { k: "linkLabel", t: "text", l: "Button text for that link", max: 24, ph: "Buy tickets, Donate, Sign up…" },
      { k: "photo", t: "image", l: "Main photo", hint: "Wide (landscape) photos look best." },
      { k: "photos", t: "images", l: "Photos from this event", hint: "Add these after the event happens." },
      { k: "series", t: "select", l: "Part of which big event", opts: seriesOpts, hint: "Pick the big event or special page this belongs to (like Homecoming or Christmas Jars). Once it's over, its photos and description show under that event's \"View past events\"." },
    ],
    committee: [
      { k: "name", t: "text", l: "Name", max: 30, after: (o) => o._newSlug && (o.slug = slugify(o.name)) },
      { k: "type", t: "select", l: "Type", hint: "Class committees call their leader Class President instead of Chair.", opts: () => [opt("committee", "Committee"), opt("class", "Class committee (sophomore, junior, senior…)")] },
      { k: "tagline", t: "text", l: "One-line summary", max: 90 },
      { k: "theme", t: "text", l: "This year's theme (optional)", max: 40, hint: "For example a senior theme. Shows big on the page. Leave blank if there isn't one." },
      { k: "description", t: "textarea", l: "Description", hint: "Leave a blank line between paragraphs." },
      { k: "photo", t: "image", l: "Main photo", hint: "Used at the top of the page and on cards." },
      { k: "groupPhoto", t: "image", l: "Group photo", hint: "Shown with the list of names under it." },
      ...homeFields("never"),
      { k: "sboId", t: "select", l: "SBO over this committee", opts: () => peopleOpts("sbo") },
      { k: "memberIds", t: "people", l: "Members", hint: "Add people on the People tab first." },
      { k: "chairId", t: "select", l: "Chair (class president for class committees)", hint: "For class committees, set the 2 vice presidents' Position to Vice President on the People tab.", opts: (o) => [opt("", "Nobody yet")].concat((o.memberIds || []).map((id) => D().people.find((p) => p.id === id)).filter(Boolean).map((p) => opt(p.id, p.name || "Unnamed"))) },
      {
        k: "highlights",
        t: "list",
        l: "Highlighted big events",
        hint: "Big events this committee plans, like Homecoming. Each gets its details and photos year by year.",
        item: "highlight",
        title: (h) => h.title || "New big event",
        fields: [
          { k: "title", t: "text", l: "Name", max: 30 },
          { k: "summary", t: "text", l: "One-line summary", max: 100 },
          { k: "photo", t: "image", l: "Photo" },
          { k: "alsoOn", t: "multi", l: "Also show on", hint: "For big events planned together, like Homecoming.", opts: () => D().committees.map((c) => opt(c.id, c.name)) },
          ...homeFields("never"),
        ],
        make: () => ({ id: uid(), title: "", summary: "", photo: "", alsoOn: [], years: [] }),
      },
      {
        k: "scoreboard",
        t: "group",
        l: "Class scoreboard (spirit bowls)",
        fields: [
          { k: "enabled", t: "check", l: "Show a class scoreboard on this page" },
          { k: "title", t: "text", l: "Scoreboard title", max: 30, ph: "Spirit Bowls" },
          { k: "intro", t: "textarea", l: "How it works" },
          {
            k: "bowls",
            t: "list",
            l: "Spirit bowls / rounds",
            item: "spirit bowl",
            title: (b) => b.name || "New spirit bowl",
            fields: [{ k: "name", t: "text", l: "Name", max: 40 }, { k: "date", t: "date", l: "Date" }, { k: "description", t: "textarea", l: "Description" }, { k: "scores", t: "scores", l: "Points for each class" }, { k: "photos", t: "images", l: "Photos" }],
            make: () => ({ id: uid(), name: "", date: "", description: "", scores: {}, photos: [] }),
          },
        ],
      },
    ],
    person: [
      { k: "name", t: "text", l: "Full name", max: 40 },
      { k: "kind", t: "select", l: "Group", opts: () => [opt("student", "Student member"), opt("sbo", "SBO (student body officer)"), opt("adviser", "Advisor")] },
      { k: "title", t: "text", l: "Position", max: 40, ph: "Member, Vice President, Advisor…" },
      { k: "_committees", t: "multi", l: "Committees they're on", opts: () => D().committees.map((c) => opt(c.id, c.name)), virtual: true },
      { k: "photo", t: "image", l: "Headshot", hint: "Tall (portrait) photos look best." },
      { k: "bio", t: "textarea", l: "A little about them", max: 500 },
      { k: "duties", t: "textarea", l: "What they do (SBOs only)", max: 300, showIf: (o) => o.kind === "sbo" },
      { k: "email", t: "email", l: "Email (shows on the site)" },
      { k: "instagram", t: "text", l: "Instagram (optional)", max: 60, ph: "@username" },
    ],
    page: [
      { k: "title", t: "text", l: "Page title", max: 30, after: (o) => o._newSlug && (o.slug = slugify(o.title)) },
      { k: "kicker", t: "text", l: "Small label above the title", max: 30 },
      { k: "subtitle", t: "text", l: "Subtitle", max: 120 },
      { k: "inMenu", t: "check", l: "Show in the top menu" },
      ...homeFields("always"),
      { k: "photo", t: "image", l: "Main photo" },
      { k: "body", t: "textarea", l: "About text" },
      { k: "donateUrl", t: "url", l: "Donation link", hint: "Used for the Donate button and the automatic total." },
      { k: "donateLabel", t: "text", l: "Donate button text", max: 24 },
      { k: "lastDay", t: "date", l: "Last day to give (optional)", hint: "Shows a \"days left to give\" countdown under the total." },
      { k: "bigEventId", t: "select", l: "\"Don't miss\" countdown (optional)", hint: "Counts down to one big event, like Stuff the Jars Night.", opts: () => [opt("", "None")].concat(D().events.filter((e) => !WSG.isPast || !WSG.isPast(e)).map((e) => opt(e.id, e.title || "Untitled"))) },
      {
        k: "story",
        t: "group",
        l: "Our story (optional)",
        fields: [
          { k: "title", t: "text", l: "Title", max: 50 },
          { k: "text", t: "textarea", l: "Intro", max: 400 },
          { k: "logo", t: "image", l: "Logo or photo next to it", png: true, max: 900 },
          { k: "steps", t: "list", l: "Timeline", item: "step", title: (x) => x.label || "New step", fields: [{ k: "label", t: "text", l: "Label (like a year)", max: 20 }, { k: "text", t: "textarea", l: "What happened", max: 300 }], make: () => ({ label: "", text: "" }) },
        ],
      },
      {
        k: "ways",
        t: "group",
        l: "Two ways to give (optional)",
        fields: [
          { k: "on", t: "check", l: "Show this section" },
          { k: "onlineText", t: "textarea", l: "Donate online text", max: 200 },
          { k: "eventText", t: "textarea", l: "Come to an event text", max: 200 },
        ],
      },
      { k: "links", t: "list", l: "Extra buttons (optional)", hint: "Like an Instagram account.", item: "button", title: (x) => x.label || "New button", fields: [{ k: "label", t: "text", l: "Button text", max: 30 }, { k: "url", t: "url", l: "Link" }], make: () => ({ label: "", url: "" }) },
      { k: "faq", t: "list", l: "Questions and answers (optional)", item: "question", title: (x) => x.q || "New question", fields: [{ k: "q", t: "text", l: "Question", max: 80 }, { k: "a", t: "textarea", l: "Answer", max: 400 }], make: () => ({ q: "", a: "" }) },
      { k: "showTotal", t: "check", l: "Show the amount raised" },
      { k: "autoTotal", t: "check", l: "Include the live total", hint: "Reads the total from the SuccessFund donation link every 30 minutes." },
      { k: "goal", t: "number", l: "Goal ($)" },
      { k: "manualRaised", t: "number", l: "Amount to add by hand ($)", hint: "Added on top of the live total, like money raised through a different donation link. If the live total is off, this is the whole total. Use 0 for none." },
    ],
    audience: [{ k: "label", t: "text", l: "Filter name", max: 26 }],
    announcement: [
      { k: "on", t: "check", l: "Show the banner", hint: "A red banner across the top of every page." },
      { k: "text", t: "textarea", l: "Announcement", max: 160, hint: "Keep it short, like \"Spirit Bowl this Friday in the main gym!\"" },
      { k: "linkLabel", t: "text", l: "Button text (optional)", max: 24, ph: "Learn more" },
      { k: "linkUrl", t: "url", l: "Button link (optional)", hint: "Leave blank for no button. Can be a page on this site, like #/events." },
      { k: "until", t: "date", l: "Hide it after (optional)", hint: "The banner turns itself off after this day. Leave blank to keep it up until you turn it off." },
    ],
    teams: [
      {
        k: "teams",
        t: "list",
        l: "Teams",
        hint: "Each team gets a bar on the scoreboard. Points are entered on each spirit bowl.",
        item: "team",
        title: (t) => t.label || "New team",
        fields: [
          { k: "label", t: "text", l: "Team name", max: 20 },
          { k: "color", t: "color", l: "Bar color" },
        ],
        make: () => ({ id: uid(), label: "", color: "#6CA9E2" }),
      },
    ],
    homeScores: [{ k: "showScores", t: "check", l: "Show the standings on the home page", hint: "Shows the scoreboard graph under Coming up." }],
  };

  /* ================= form builder ================= */
  function el(tag, attrs = {}, html = "") {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
    }
    if (html) e.innerHTML = html;
    return e;
  }
  function buildForm(obj, fields, onChange) {
    const wrap = el("div", { class: "ed-form" });
    const rows = [];
    fields.forEach((f) => {
      const row = field(obj, f, () => {
        if (f.after) f.after(obj);
        rows.forEach((r) => r.sync && r.sync());
        onChange();
      });
      row.sync = () => (row.style.display = f.showIf && !f.showIf(obj) ? "none" : "");
      row.sync();
      rows.push(row);
      wrap.appendChild(row);
    });
    return wrap;
  }
  function labelEl(f) {
    return el("div", { class: "ed-label" }, `${esc(f.l)}${f.hint ? `<small>${esc(f.hint)}</small>` : ""}`);
  }
  function field(obj, f, onChange) {
    const row = el("div", { class: "ed-row ed-t-" + f.t });
    const set = (v) => {
      obj[f.k] = v;
      onChange();
    };
    if (f.t === "check") {
      const id = "f" + uid();
      const cb = el("input", { type: "checkbox", id });
      cb.checked = !!obj[f.k];
      cb.addEventListener("change", () => set(cb.checked));
      const lab = el("label", { for: id, class: "ed-check" });
      lab.appendChild(cb);
      lab.appendChild(el("span", {}, `${esc(f.l)}${f.hint ? `<small>${esc(f.hint)}</small>` : ""}`));
      row.appendChild(lab);
      return row;
    }
    if (f.t === "group") {
      if (!obj[f.k] || typeof obj[f.k] !== "object") obj[f.k] = {};
      const box = el("fieldset", { class: "ed-group" });
      box.appendChild(el("legend", {}, esc(f.l)));
      box.appendChild(buildForm(obj[f.k], f.fields, onChange));
      row.appendChild(box);
      return row;
    }
    row.appendChild(labelEl(f));
    const val = obj[f.k];
    if (["text", "email", "url", "number", "date", "datetime"].includes(f.t)) {
      const type = { datetime: "datetime-local", url: "url", email: "email", number: "number", date: "date" }[f.t] || "text";
      const inp = el("input", { type, maxlength: f.max || false, placeholder: f.ph || (f.t === "url" ? "https://…" : false), inputmode: f.t === "number" ? "decimal" : false });
      inp.value = val == null ? "" : f.t === "date" ? String(val).slice(0, 10) : val;
      inp.addEventListener("input", () => set(f.t === "number" ? (inp.value === "" ? 0 : Number(inp.value)) : inp.value));
      row.appendChild(inp);
      if (f.max && f.t === "text") counter(row, inp, f.max);
    } else if (f.t === "color") {
      const wrap = el("div", { class: "ed-color" });
      const pick = el("input", { type: "color" });
      const txt = el("input", { type: "text", maxlength: 7 });
      pick.value = txt.value = /^#[0-9a-f]{6}$/i.test(val || "") ? val : "#6CA9E2";
      pick.addEventListener("input", () => ((txt.value = pick.value), set(pick.value)));
      txt.addEventListener("input", () => /^#[0-9a-f]{6}$/i.test(txt.value) && ((pick.value = txt.value), set(txt.value)));
      wrap.appendChild(pick);
      wrap.appendChild(txt);
      row.appendChild(wrap);
    } else if (f.t === "textarea") {
      const ta = el("textarea", { rows: 4, maxlength: f.max || false });
      ta.value = val || "";
      ta.addEventListener("input", () => set(ta.value));
      row.appendChild(ta);
      if (f.max) counter(row, ta, f.max);
    } else if (f.t === "select") {
      const sel = el("select");
      const opts = f.opts(obj);
      opts.forEach((o) => sel.appendChild(el("option", { value: o.v }, esc(o.l))));
      if (val && !opts.some((o) => o.v === val)) sel.appendChild(el("option", { value: val }, "(missing)"));
      sel.value = val || f.dflt || "";
      if (!val && f.dflt) obj[f.k] = f.dflt;
      sel.addEventListener("change", () => set(sel.value));
      row.appendChild(sel);
      row.addEventListener("focusin", () => {
        // refresh options (lists can change while editing)
        const cur = sel.value;
        sel.innerHTML = "";
        f.opts(obj).forEach((o) => sel.appendChild(el("option", { value: o.v }, esc(o.l))));
        sel.value = cur;
      });
    } else if (f.t === "multi") {
      const box = el("div", { class: "ed-chips" });
      const current = () => (f.virtual ? virtualGet(obj, f.k) : obj[f.k] || []);
      const draw = () => {
        box.innerHTML = "";
        const cur = current();
        f.opts(obj).forEach((o) => {
          const b = el("button", { type: "button", class: "ed-chip" + (cur.includes(o.v) ? " on" : ""), "aria-pressed": cur.includes(o.v) }, esc(o.l));
          b.addEventListener("click", () => {
            const now = current().slice();
            const i = now.indexOf(o.v);
            i >= 0 ? now.splice(i, 1) : now.push(o.v);
            if (f.virtual) {
              virtualSet(obj, f.k, now);
              onChange();
            } else set(now);
            draw();
          });
          box.appendChild(b);
        });
      };
      draw();
      row.appendChild(box);
    } else if (f.t === "people") {
      row.appendChild(peoplePicker(obj, f, onChange));
    } else if (f.t === "image") {
      row.appendChild(imageInput(obj, f, onChange));
    } else if (f.t === "images") {
      row.appendChild(imagesInput(obj, f, onChange));
    } else if (f.t === "scores") {
      if (!obj[f.k]) obj[f.k] = {};
      const grid = el("div", { class: "ed-scores" });
      WSG.teams()
        .forEach((g) => {
          const lab = el("label", {}, `<span>${esc(g.label)}</span>`);
          const inp = el("input", { type: "number", inputmode: "numeric" });
          inp.value = obj[f.k][g.id] ?? "";
          inp.addEventListener("input", () => {
            obj[f.k][g.id] = inp.value === "" ? 0 : Number(inp.value);
            onChange();
          });
          lab.appendChild(inp);
          grid.appendChild(lab);
        });
      row.appendChild(grid);
    } else if (f.t === "list") {
      row.appendChild(listInput(obj, f, onChange));
    }
    return row;
  }
  function counter(row, inp, max) {
    const c = el("small", { class: "ed-count" });
    const upd = () => (c.textContent = `${inp.value.length}/${max}`);
    inp.addEventListener("input", upd);
    upd();
    row.appendChild(c);
  }
  function virtualGet(obj, k) {
    if (k === "_committees") return D().committees.filter((c) => (c.memberIds || []).includes(obj.id)).map((c) => c.id);
    return [];
  }
  function virtualSet(obj, k, ids) {
    if (k === "_committees")
      D().committees.forEach((c) => {
        c.memberIds = c.memberIds || [];
        const has = c.memberIds.includes(obj.id);
        if (ids.includes(c.id) && !has) c.memberIds.push(obj.id);
        if (!ids.includes(c.id) && has) {
          c.memberIds = c.memberIds.filter((x) => x !== obj.id);
          if (c.chairId === obj.id) c.chairId = "";
        }
      });
  }
  function peoplePicker(obj, f, onChange) {
    const box = el("div", { class: "ed-people" });
    const draw = () => {
      box.innerHTML = "";
      const ids = obj[f.k] || (obj[f.k] = []);
      const list = el("div", { class: "ed-chips" });
      ids.forEach((id) => {
        const p = D().people.find((x) => x.id === id);
        if (!p) return;
        const b = el("button", { type: "button", class: "ed-chip on", title: "Remove" }, `${esc(p.name || "Unnamed")} ✕`);
        b.addEventListener("click", () => {
          obj[f.k] = ids.filter((x) => x !== id);
          if (obj.chairId === id) obj.chairId = "";
          onChange();
          draw();
        });
        list.appendChild(b);
      });
      if (!ids.length) list.appendChild(el("span", { class: "ed-muted" }, "No members yet."));
      box.appendChild(list);
      const sel = el("select", { class: "ed-add-person" });
      sel.appendChild(el("option", { value: "" }, "+ Add a person…"));
      D()
        .people.filter((p) => !ids.includes(p.id))
        .forEach((p) => sel.appendChild(el("option", { value: p.id }, esc((p.name || "Unnamed") + (p.title ? " · " + p.title : "")))));
      sel.addEventListener("change", () => {
        if (!sel.value) return;
        ids.push(sel.value);
        onChange();
        draw();
      });
      box.appendChild(sel);
    };
    draw();
    return box;
  }
  function listInput(obj, f, onChange) {
    const box = el("div", { class: "ed-list" });
    const draw = (openIdx = -1) => {
      box.innerHTML = "";
      const arr = obj[f.k] || (obj[f.k] = []);
      arr.forEach((item, i) => {
        const det = el("details", { class: "ed-sub" });
        if (i === openIdx) det.open = true;
        const sum = el("summary", {}, `<span>${esc(f.title(item))}</span>`);
        const tools = el("span", { class: "ed-tools" });
        tools.appendChild(toolBtn("↑", "Move up", i === 0, () => (arr.splice(i - 1, 0, arr.splice(i, 1)[0]), onChange(), draw(i - 1))));
        tools.appendChild(toolBtn("↓", "Move down", i === arr.length - 1, () => (arr.splice(i + 1, 0, arr.splice(i, 1)[0]), onChange(), draw(i + 1))));
        tools.appendChild(
          toolBtn("🗑", "Delete", false, async () => {
            if (!(await confirmBox(`Delete "${f.title(item)}"?`, "This can't be undone after you publish."))) return;
            arr.splice(i, 1);
            if (item.id) unlinkSeries(item.id);
            onChange();
            draw();
          })
        );
        sum.appendChild(tools);
        det.appendChild(sum);
        det.appendChild(
          buildForm(item, f.fields, () => {
            $("summary>span", det).textContent = f.title(item);
            onChange();
          })
        );
        box.appendChild(det);
      });
      const add = el("button", { type: "button", class: "ed-btn ed-btn-soft" }, `+ Add ${esc(f.item || "item")}`);
      add.addEventListener("click", () => {
        arr.push(f.make());
        onChange();
        draw(arr.length - 1);
      });
      box.appendChild(add);
    };
    draw();
    return box;
  }
  function toolBtn(txt, title, disabled, fn) {
    const b = el("button", { type: "button", class: "ed-tool", title, "aria-label": title, disabled }, txt);
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    });
    return b;
  }

  /* ---------- images ---------- */
  async function compress(file, maxSide = 1800, png = false) {
    const bmp = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error("That file isn't an image this browser can read. Try a JPG or PNG."));
      im.src = URL.createObjectURL(file);
    });
    let w = bmp.naturalWidth,
      h = bmp.naturalHeight;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    w = Math.round(w * scale);
    h = Math.round(h * scale);
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext("2d");
    if (!png) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(bmp, 0, 0, w, h);
    URL.revokeObjectURL(bmp.src);
    return cv.toDataURL(png ? "image/png" : "image/jpeg", 0.82);
  }
  async function uploadImage(file, f = {}) {
    const dataUrl = await compress(file, f.max || 1800, !!f.png);
    const ext = f.png ? "png" : "jpg";
    const base = slugify(file.name.replace(/\.[^.]+$/, "")).slice(0, 24) || "photo";
    const path = `assets/uploads/${new Date().getFullYear()}/${Date.now().toString(36)}-${base}.${ext}`;
    await store.put(path, dataUrl.split(",")[1], `Upload photo ${path}`);
    WSG.localImgs[path] = dataUrl;
    return path;
  }
  function pickFiles(multiple) {
    return new Promise((res) => {
      const inp = el("input", { type: "file", accept: "image/*", multiple });
      inp.addEventListener("change", () => res(Array.from(inp.files || [])));
      inp.click();
    });
  }
  function imageInput(obj, f, onChange) {
    const box = el("div", { class: "ed-image" });
    const draw = (busy) => {
      box.innerHTML = "";
      const th = el("div", { class: "ed-thumb" }, obj[f.k] ? `<img src="${esc(WSG.imgSrc(obj[f.k]))}" alt="">` : "<span>No photo</span>");
      box.appendChild(th);
      const btns = el("div", { class: "ed-image-btns" });
      const up = el("button", { type: "button", class: "ed-btn ed-btn-soft", disabled: busy }, busy ? "Uploading…" : obj[f.k] ? "Replace photo" : "Upload photo");
      up.addEventListener("click", async () => {
        const [file] = await pickFiles(false);
        if (!file) return;
        draw(true);
        try {
          obj[f.k] = await uploadImage(file, f);
          onChange();
        } catch (e) {
          toast(e.message || "Upload failed", true);
        }
        draw(false);
      });
      btns.appendChild(up);
      const pre = el("button", { type: "button", class: "ed-btn ed-btn-soft", disabled: busy }, "Pick a preset");
      pre.addEventListener("click", async () => {
        const src = await pickPreset();
        if (!src) return;
        obj[f.k] = src;
        onChange();
        draw(false);
      });
      btns.appendChild(pre);
      const isPreset = obj[f.k] && WSG.presets().some((x) => x.src === obj[f.k]);
      if (obj[f.k] && !isPreset) {
        const save = el("button", { type: "button", class: "ed-btn ed-btn-ghost" }, "Save as preset");
        save.addEventListener("click", async () => {
          const label = await askText("Save as preset", "Name it so it's easy to find later, like \"Volleyball team huddle\".", "Preset name");
          if (!label) return;
          (D().site.presets || (D().site.presets = [])).push({ src: obj[f.k], label });
          changed();
          toast("Saved as a preset. It's in \"Pick a preset\" everywhere now.");
          draw(false);
        });
        btns.appendChild(save);
      }
      if (obj[f.k]) {
        const rm = el("button", { type: "button", class: "ed-btn ed-btn-ghost" }, "Remove");
        rm.addEventListener("click", () => {
          obj[f.k] = "";
          onChange();
          draw(false);
        });
        btns.appendChild(rm);
      }
      box.appendChild(btns);
    };
    draw(false);
    return box;
  }
  function imagesInput(obj, f, onChange) {
    const box = el("div", { class: "ed-images" });
    const draw = (busyText) => {
      box.innerHTML = "";
      const arr = obj[f.k] || (obj[f.k] = []);
      const grid = el("div", { class: "ed-img-grid" });
      arr.forEach((p, i) => {
        const card = el("div", { class: "ed-img-card" }, `<div class="ed-thumb">${p.src ? `<img src="${esc(WSG.imgSrc(p.src))}" alt="">` : "<span>Placeholder</span>"}</div>`);
        const cap = el("input", { type: "text", placeholder: "Caption (optional)", maxlength: 80 });
        cap.value = p.caption || "";
        cap.addEventListener("input", () => {
          p.caption = cap.value;
          onChange();
        });
        card.appendChild(cap);
        const tools = el("div", { class: "ed-tools" });
        tools.appendChild(toolBtn("←", "Move earlier", i === 0, () => (arr.splice(i - 1, 0, arr.splice(i, 1)[0]), onChange(), draw())));
        tools.appendChild(toolBtn("→", "Move later", i === arr.length - 1, () => (arr.splice(i + 1, 0, arr.splice(i, 1)[0]), onChange(), draw())));
        tools.appendChild(toolBtn("🗑", "Remove photo", false, () => (arr.splice(i, 1), onChange(), draw())));
        card.appendChild(tools);
        grid.appendChild(card);
      });
      box.appendChild(grid);
      const add = el("button", { type: "button", class: "ed-btn ed-btn-soft", disabled: !!busyText }, busyText || "+ Add photos");
      add.addEventListener("click", async () => {
        const files = await pickFiles(true);
        if (!files.length) return;
        for (let i = 0; i < files.length; i++) {
          draw(`Uploading ${i + 1} of ${files.length}…`);
          try {
            const path = await uploadImage(files[i], f);
            arr.push({ src: path, caption: "" });
            onChange();
          } catch (e) {
            toast(e.message || "Upload failed", true);
          }
        }
        draw();
      });
      box.appendChild(add);
    };
    draw();
    return box;
  }

  /* ================= collections (tabs) ================= */
  const TABS = [
    { id: "site", label: "Site & home" },
    { id: "banner", label: "Banner" },
    { id: "scores", label: "Scoreboard" },
    { id: "events", label: "Events" },
    { id: "committees", label: "Committees" },
    { id: "people", label: "People" },
    { id: "pages", label: "Special pages" },
    { id: "school", label: "School events" },
    { id: "filters", label: "Filters" },
    { id: "settings", label: "Settings" },
  ];
  const COLL = {
    events: {
      arr: () => D().events,
      schema: S.event,
      noun: "event",
      title: (e) => e.title || "New event",
      sub: (e) => `${WSG.fmtWhen(e)}${e.ours ? "" : " · promoted"}`,
      sort: (a, b) => (b.start || "").localeCompare(a.start || ""),
      make: () => ({ id: uid(), title: "", start: "", end: "", location: "", description: "", audiences: [], committee: "", ours: true, featured: false, photo: "", photos: [], link: "", linkLabel: "", cost: "", dressCode: "", series: "" }),
      onDelete: () => {},
    },
    committees: {
      arr: () => D().committees,
      schema: S.committee,
      noun: "committee",
      adviserDelete: true,
      title: (c) => c.name || "New committee",
      sub: (c) => (c.type === "class" ? "Class committee" : "Committee") + ` · ${(c.memberIds || []).length} members`,
      make: () => ({ id: uid(), _newSlug: true, slug: "", name: "", type: "committee", tagline: "", theme: "", description: "", photo: "", groupPhoto: "", sboId: "", chairId: "", memberIds: [], highlights: [], scoreboard: { enabled: false, title: "", intro: "", bowls: [] } }),
      onDelete: (c) => {
        D().events.forEach((e) => e.committee === c.id && (e.committee = ""));
        (c.highlights || []).forEach((h) => unlinkSeries(h.id));
      },
    },
    people: {
      arr: () => D().people,
      schema: S.person,
      noun: "person",
      title: (p) => p.name || "New person",
      sub: (p) => ({ sbo: "SBO", adviser: "Advisor", student: "Member" }[p.kind] || "") + (p.title ? " · " + p.title : ""),
      groupBy: (p) => ({ sbo: "SBOs", student: "Student members", adviser: "Advisors" }[p.kind] || "Other"),
      make: () => ({ id: uid(), name: "", kind: "student", title: "Member", duties: "", bio: "", photo: "", email: "", instagram: "" }),
      onDelete: (p) =>
        D().committees.forEach((c) => {
          c.memberIds = (c.memberIds || []).filter((x) => x !== p.id);
          if (c.chairId === p.id) c.chairId = "";
          if (c.sboId === p.id) c.sboId = "";
        }),
    },
    pages: {
      arr: () => D().pages || (D().pages = []),
      schema: S.page,
      noun: "special page",
      adviserDelete: true,
      title: (p) => p.title || "New page",
      sub: (p) => "/" + (p.slug || ""),
      make: () => ({ id: uid(), _newSlug: true, slug: "", title: "", kicker: "", subtitle: "", inMenu: true, homeMode: "always", homeFrom: "1", homeTo: "12", photo: "", body: "", donateUrl: "", donateLabel: "Donate", showTotal: false, autoTotal: false, goal: 0, manualRaised: 0, years: [] }),
      onDelete: (p) => unlinkSeries(p.id),
    },
    filters: {
      arr: () => D().audiences,
      schema: S.audience,
      noun: "filter",
      title: (a) => a.label || "New filter",
      sub: () => "Audience",
      make: () => ({ id: uid(), label: "" }),
      onDelete: (a) => D().events.forEach((e) => (e.audiences = (e.audiences || []).filter((x) => x !== a.id))),
    },
  };
  function unlinkSeries(id) {
    D().events.forEach((e) => e.series === id && (e.series = ""));
  }

  /* ================= shell UI ================= */
  let shell = null;
  function buildShell() {
    if (shell) return;
    const root = $("#editorRoot");
    root.innerHTML = `
      <div class="ed-bar" id="edBar">
        <span class="ed-dot"></span><span id="edStatus">Editing</span>
        <button class="ed-btn ed-btn-soft" id="edOpen" type="button">Open editor</button>
        <button class="ed-btn ed-btn-gold" id="edPublish" type="button">Publish</button>
        <button class="ed-btn ed-btn-ghost" id="edMore" type="button" aria-label="More">⋯</button>
        <div class="ed-menu" id="edMenu" hidden>
          <button type="button" data-act="discard">Discard unpublished changes</button>
          <button type="button" data-act="backup">Download a backup</button>
          <button type="button" data-act="exit">Exit edit mode</button>
        </div>
      </div>
      <aside class="ed-panel" id="edPanel" aria-label="Site editor" hidden>
        <header class="ed-head"><div><b>Edit site</b><small id="edRole"></small></div><button class="ed-x" id="edClose" type="button" aria-label="Close editor">&times;</button></header>
        <nav class="ed-tabs" id="edTabs"></nav>
        <div class="ed-body" id="edBody"></div>
      </aside>`;
    shell = root;
    $("#edOpen").addEventListener("click", () => openPanel());
    $("#edClose").addEventListener("click", closePanel);
    $("#edPublish").addEventListener("click", publish);
    $("#edMore").addEventListener("click", () => ($("#edMenu").hidden = !$("#edMenu").hidden));
    $("#edMenu").addEventListener("click", async (e) => {
      const act = e.target.dataset.act;
      $("#edMenu").hidden = true;
      if (act === "discard") {
        if (!(await confirmBox("Discard unpublished changes?", "Everything you changed since the last publish will be lost."))) return;
        clearDraft();
        dirty = false;
        location.reload();
      } else if (act === "backup") {
        const a = el("a", { href: URL.createObjectURL(new Blob([JSON.stringify(D(), null, 1)], { type: "application/json" })), download: `wsg-site-backup-${new Date().toISOString().slice(0, 10)}.json` });
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else if (act === "exit") {
        if (dirty && !(await confirmBox("Exit without publishing?", "Your unpublished changes stay saved on this device until you publish or discard them."))) return;
        sessionStorage.removeItem(SESSION_KEY);
        location.reload();
      }
    });
    $("#edTabs").addEventListener("click", (e) => {
      const b = e.target.closest("[data-tab]");
      if (!b) return;
      view = { tab: b.dataset.tab, id: null };
      drawPanel();
    });
    $("#edRole").textContent = (session.role === "adviser" ? "Advisor" : "Editor") + (session.test ? " · preview copy (not the live site)" : "");
    document.body.classList.add("editing");
  }
  function updateBar() {
    if (!shell) return;
    $("#edStatus").textContent = dirty ? "Unpublished changes" : "Editing · all published";
    $("#edBar").classList.toggle("dirty", dirty);
  }
  function openPanel(target) {
    $("#edPanel").hidden = false;
    document.body.classList.add("ed-panel-open");
    if (target) view = target;
    drawPanel();
  }
  function closePanel() {
    $("#edPanel").hidden = true;
    document.body.classList.remove("ed-panel-open");
  }
  function drawPanel() {
    $("#edTabs").innerHTML = TABS.map((t) => `<button type="button" data-tab="${t.id}" class="${view.tab === t.id ? "on" : ""}">${t.label}</button>`).join("");
    const body = $("#edBody");
    body.innerHTML = "";
    body.scrollTop = 0;
    if (view.tab === "site") {
      body.appendChild(el("h3", {}, "Site & home page"));
      body.appendChild(buildForm(D().site, S.site, changed));
      body.appendChild(el("h3", {}, "Home page photos"));
      body.appendChild(buildForm(D().home, S.home, changed));
    } else if (view.tab === "school") {
      drawSchool(body);
    } else if (view.tab === "banner") {
      if (!D().site.announcement) D().site.announcement = { on: false, text: "", linkLabel: "", linkUrl: "", until: "" };
      body.appendChild(el("h3", {}, "Announcement banner"));
      body.appendChild(el("p", { class: "ed-intro" }, "Visitors can close the banner. If you change the message, it shows again for everyone."));
      body.appendChild(buildForm(D().site.announcement, S.announcement, () => changed({ now: true })));
    } else if (view.tab === "scores") {
      if (!Array.isArray(D().site.teams)) D().site.teams = [];
      body.appendChild(el("h3", {}, "Scoreboard"));
      const host = D().committees.find((c) => c.scoreboard && c.scoreboard.enabled);
      const go = el("button", { type: "button", class: "ed-btn ed-btn-gold ed-add" }, host ? `Enter spirit bowl points (${esc(host.name)})` : "Turn on a scoreboard on a committee first");
      go.addEventListener("click", () => {
        if (!host) return (view = { tab: "committees", id: null }), drawPanel();
        view = { tab: "committees", id: host.id, focus: "score" };
        drawPanel();
      });
      body.appendChild(go);
      body.appendChild(buildForm(D().home, S.homeScores, changed));
      body.appendChild(buildForm(D().site, S.teams, changed));
    } else if (view.tab === "settings") drawSettings(body);
    else if (view.id) drawItem(body);
    else drawList(body);
  }
  function drawSchool(body) {
    const site = D().site;
    if (!site.schoolCalendar) site.schoolCalendar = { on: true, url: "" };
    if (!site.schoolOverrides) site.schoolOverrides = {};
    body.appendChild(el("h3", {}, "School events"));
    body.appendChild(
      el(
        "p",
        { class: "ed-intro" },
        "Home games, concerts, shows and community nights from the Westlake High calendar come in by themselves once a day. They show under \"Also happening\" on the Events page, and on the home page only the day before and the day of. Hide any you don't want."
      )
    );
    body.appendChild(
      buildForm(site.schoolCalendar, [
        { k: "on", t: "check", l: "Bring in events from the Westlake High calendar" },
        { k: "url", t: "url", l: "Calendar link (optional)", hint: "Leave blank to use the Westlake High calendar. Only change this if the school's calendar link changes." },
      ], () => changed({ now: true }))
    );
    const list = WSG.schoolEventsRaw();
    const updated = WSG.school && WSG.school.updated ? new Date(WSG.school.updated) : null;
    body.appendChild(el("div", { class: "ed-group-title" }, `${list.length} upcoming school events${updated ? " · checked " + updated.toLocaleDateString() : ""}`));
    if (!list.length) body.appendChild(el("p", { class: "ed-muted" }, "None yet. The list fills in after the daily check runs."));
    const box = el("div", { class: "ed-items" });
    list.forEach((e) => {
      const o = site.schoolOverrides[e.id] || {};
      const row = el("div", { class: "ed-item ed-school" + (o.hide ? " off" : "") });
      row.appendChild(el("div", { class: "ed-item-main" }, `<b>${esc(e.title)}</b><small>${esc(WSG.fmtWhen(e))}</small>`));
      const sel = el("select", { "aria-label": "Home page" });
      [["auto", "Home: automatic"], ["always", "Home: always"], ["never", "Home: never"]].forEach(([v, l]) => sel.appendChild(el("option", { value: v }, l)));
      sel.value = o.homeShow || "auto";
      sel.addEventListener("change", () => {
        site.schoolOverrides[e.id] = { ...(site.schoolOverrides[e.id] || {}), homeShow: sel.value };
        changed({ now: true });
      });
      const hide = el("button", { type: "button", class: "ed-btn " + (o.hide ? "ed-btn-gold" : "ed-btn-ghost") }, o.hide ? "Show" : "Hide");
      hide.addEventListener("click", () => {
        site.schoolOverrides[e.id] = { ...(site.schoolOverrides[e.id] || {}), hide: !o.hide };
        changed({ now: true });
        drawPanel();
      });
      const tools = el("span", { class: "ed-tools" });
      tools.appendChild(sel);
      tools.appendChild(hide);
      row.appendChild(tools);
      box.appendChild(row);
    });
    body.appendChild(box);
  }
  function drawList(body) {
    const c = COLL[view.tab];
    const arr = c.arr();
    const intro = {
      events: "Add every event here. Uncheck \"Planned by student government\" for events you're only promoting.",
      committees: "Each committee, including each class, gets its own page and a link in the menu. Big events like Homecoming go inside the committee that plans them.",
      people: "Add every person once, then put them on committees. SBOs and advisers show on the Committees and Members pages.",
      pages: "Pages for special campaigns like Christmas Jars, with a donate button and an amount-raised bar.",
      filters: "The \"Who it's for\" filters on the Events page.",
    }[view.tab];
    body.appendChild(el("p", { class: "ed-intro" }, esc(intro)));
    const add = el("button", { type: "button", class: "ed-btn ed-btn-gold ed-add" }, `+ Add ${c.noun}`);
    add.addEventListener("click", () => {
      const item = c.make();
      arr.push(item);
      changed();
      view = { tab: view.tab, id: item.id || arr.length - 1 };
      drawPanel();
    });
    body.appendChild(add);
    let items = arr.map((x, i) => ({ x, i }));
    if (c.sort) items = items.slice().sort((a, b) => c.sort(a.x, b.x));
    let lastGroup = null;
    const list = el("div", { class: "ed-items" });
    items.forEach(({ x, i }) => {
      if (c.groupBy) {
        const g = c.groupBy(x);
        if (g !== lastGroup) {
          list.appendChild(el("div", { class: "ed-group-title" }, esc(g)));
          lastGroup = g;
        }
      }
      const row = el("div", { class: "ed-item" });
      const main = el("button", { type: "button", class: "ed-item-main" }, `<b>${esc(c.title(x))}</b><small>${esc(c.sub(x))}</small>`);
      main.addEventListener("click", () => {
        view = { tab: view.tab, id: x.id || i };
        drawPanel();
      });
      row.appendChild(main);
      const tools = el("span", { class: "ed-tools" });
      if (!c.sort) {
        tools.appendChild(toolBtn("↑", "Move up", i === 0, () => (arr.splice(i - 1, 0, arr.splice(i, 1)[0]), changed(), drawPanel())));
        tools.appendChild(toolBtn("↓", "Move down", i === arr.length - 1, () => (arr.splice(i + 1, 0, arr.splice(i, 1)[0]), changed(), drawPanel())));
      }
      tools.appendChild(toolBtn("🗑", "Delete", false, () => deleteItem(c, x)));
      row.appendChild(tools);
      list.appendChild(row);
    });
    body.appendChild(list);
  }
  async function deleteItem(c, x) {
    if (c.adviserDelete && !isAdviser()) return toast(`Only the advisor passcode can delete a whole ${c.noun}.`, true);
    if (!(await confirmBox(`Delete "${c.title(x)}"?`, `This removes it from the site when you publish.`))) return;
    const arr = c.arr();
    const i = arr.indexOf(x);
    if (i >= 0) arr.splice(i, 1);
    c.onDelete(x);
    changed({ now: true });
    if (c === COLL.committees && location.hash === `#/c/${x.slug}`) location.hash = "#/committees";
    if (c === COLL.pages && location.hash === `#/p/${x.slug}`) location.hash = "#/";
    view = { tab: view.tab, id: null };
    drawPanel();
  }
  function drawItem(body) {
    const c = COLL[view.tab];
    const arr = c.arr();
    const x = typeof view.id === "number" ? arr[view.id] : arr.find((y) => y.id === view.id);
    if (!x) {
      view.id = null;
      return drawList(body);
    }
    const back = el("button", { type: "button", class: "ed-back" }, `← All ${c.noun === "person" ? "people" : c.noun + "s"}`);
    back.addEventListener("click", () => {
      view = { tab: view.tab, id: null };
      drawPanel();
    });
    body.appendChild(back);
    const h = el("h3", {}, esc(c.title(x)));
    body.appendChild(h);
    // jump to the item's page so editors see their changes live
    if (view.tab === "committees" && x.slug && !x._newSlug && location.hash !== `#/c/${x.slug}`) location.hash = `#/c/${x.slug}`;
    if (view.tab === "pages" && x.slug && !x._newSlug && location.hash !== `#/p/${x.slug}`) location.hash = `#/p/${x.slug}`;
    const schema = c.schema;
    body.appendChild(
      buildForm(x, schema, () => {
        h.textContent = c.title(x);
        changed();
      })
    );
    const foot = el("div", { class: "ed-foot" });
    const done = el("button", { type: "button", class: "ed-btn ed-btn-navy" }, "Done");
    done.addEventListener("click", () => {
      if (x._newSlug) {
        x.slug = uniqueSlug(arr, x, x.slug || slugify(x.name || x.title));
        delete x._newSlug;
        changed({ now: true });
      }
      view = { tab: view.tab, id: null };
      drawPanel();
    });
    foot.appendChild(done);
    const del = el("button", { type: "button", class: "ed-btn ed-btn-ghost danger" }, `Delete ${c.noun}`);
    del.addEventListener("click", () => deleteItem(c, x));
    foot.appendChild(del);
    body.appendChild(foot);
    if (view.focus) {
      const target = Array.from(body.querySelectorAll("fieldset legend")).find((l) => /scoreboard/i.test(l.textContent));
      if (target) setTimeout(() => target.scrollIntoView({ block: "start" }), 50);
      view.focus = null;
    }
  }
  function uniqueSlug(arr, x, s) {
    let out = s,
      n = 2;
    while (arr.some((y) => y !== x && y.slug === out)) out = `${s}-${n++}`;
    return out;
  }

  /* ---------- settings (passcodes) ---------- */
  function drawSettings(body) {
    body.appendChild(el("h3", {}, "Settings"));
    if (session.test) body.appendChild(el("p", { class: "ed-note" }, "Test mode: changes are saved in this browser only, not on the live site."));
    if (!isAdviser()) {
      body.appendChild(el("p", { class: "ed-intro" }, "Only the advisor passcode can change passcodes or the GitHub key."));
      return;
    }
    const form = el("div", { class: "ed-form" });
    form.innerHTML = `
      <p class="ed-intro">Change these at the start of each school year, or any time a passcode gets shared too widely. Use long passphrases, like four random words.</p>
      <div class="ed-row"><div class="ed-label">New editor passcode<small>For officers and committee chairs.</small></div><input type="text" id="sEd" autocomplete="off" placeholder="Leave blank to keep it"></div>
      <div class="ed-row"><div class="ed-label">New advisor passcode<small>For advisors. Can also delete pages and change these settings.</small></div><input type="text" id="sAd" autocomplete="off" placeholder="Leave blank to keep it"></div>
      <div class="ed-row"><div class="ed-label">New GitHub key<small>Only needed if the old key expired. See the README in the GitHub repository for how to make one.</small></div><input type="password" id="sTok" autocomplete="off" placeholder="Leave blank to keep it"></div>
      <div class="ed-row"><div class="ed-label">Current advisor passcode<small>Type it to confirm.</small></div><input type="password" id="sCur" autocomplete="off"></div>
      <button class="ed-btn ed-btn-navy" id="sSave" type="button">Save settings</button>`;
    body.appendChild(form);
    $("#sSave", form).addEventListener("click", async () => {
      const ed = $("#sEd", form).value.trim(),
        ad = $("#sAd", form).value.trim(),
        tok = $("#sTok", form).value.trim(),
        cur = $("#sCur", form).value;
      if (!ed && !ad && !tok) return toast("Nothing to change.");
      for (const p of [ed, ad]) if (p && p.length < 12) return toast("Passcodes need at least 12 characters. A few words with spaces works great.", true);
      if (ed && ad && ed === ad) return toast("The editor and advisor passcodes need to be different.", true);
      const auth = await fetchAuth();
      if (!auth) return toast("Couldn't read the current settings.", true);
      const me = await unlock(auth.adviser, cur);
      if (!me) return toast("The current advisor passcode is wrong.", true);
      const secret = { token: tok || session.token };
      if (tok) {
        const ok = await checkToken({ ...session, token: tok });
        if (ok !== true) return toast(ok, true);
      }
      busy(true, "Saving…");
      try {
        const next = { ...auth };
        next.adviser = await lock(secret, ad || cur);
        if (ed) next.editor = await lock(secret, ed);
        else if (tok) {
          busy(false);
          return toast("To change the GitHub key, also type a new editor passcode (or retype the current one).", true);
        }
        await saveAuth(next);
        if (tok) session.token = tok;
        saveSession();
        toast("Settings saved. The new passcodes work in about a minute.");
        drawPanel();
      } catch (e) {
        toast("Couldn't save: " + e.message, true);
      }
      busy(false);
    });
  }

  /* ================= auth file ================= */
  async function fetchAuth() {
    if (isLocal && session && session.test) return JSON.parse(localStorage.getItem("wsg-test-auth") || "null");
    try {
      const r = await fetch("data/auth.json?v=" + Date.now(), { cache: "no-store" });
      if (!r.ok) return null;
      return await r.json();
    } catch (_) {
      return null;
    }
  }
  async function saveAuth(auth) {
    if (session.test) return localStorage.setItem("wsg-test-auth", JSON.stringify(auth));
    const sha = await store.sha("data/auth.json");
    await store.put("data/auth.json", utf8b64(JSON.stringify(auth, null, 1)), "Update edit passcodes", sha);
  }
  async function checkToken(s) {
    try {
      const repo = await gh("GET", "", null, s);
      if (!repo) return `Couldn't find the repository ${s.owner}/${s.repo}. Check the name.`;
      if (!repo.permissions || !repo.permissions.push) return "That key can't save to this repository. Make sure it has Contents: Read and write.";
      return true;
    } catch (e) {
      return e.status === 401 ? "GitHub says that key isn't valid (it may have expired)." : "GitHub error: " + e.message;
    }
  }
  function guessRepo() {
    const host = location.hostname;
    if (/\.github\.io$/i.test(host)) {
      const owner = host.split(".")[0];
      const seg = location.pathname.split("/").filter(Boolean)[0];
      return { owner, repo: seg && !/\.html?$/.test(seg) ? seg : host.toLowerCase() };
    }
    return { owner: "WestlakeStudGov", repo: "WestlakeStudGov.github.io" };
  }

  /* ================= preset library ================= */
  function pickPreset() {
    return new Promise((res) => {
      const all = WSG.presets();
      const groups = [
        ["Your saved presets", all.filter((x) => x.custom)],
        ["Sports", all.filter((x) => /volleyball|basketball|football|soccer|baseball|softball|tennis|wrestling|swim|track|golf|cheer/.test(x.kind || ""))],
        ["Arts and events", all.filter((x) => /concert|dance|theater|community|christmas|school/.test(x.kind || ""))],
        ["Logos", all.filter((x) => x.kind === "logo")],
      ].filter(([, list]) => list.length);
      const d = dialog(`<h3>Pick a preset</h3><p>Ready-made pictures in the school colors. Save your own with "Save as preset".</p>
        ${groups
          .map(
            ([name, list]) => `<div class="ed-group-title">${esc(name)}</div><div class="ed-presets">${list
              .map((x, i) => `<button type="button" class="ed-preset" data-src="${esc(x.src)}" title="${esc(x.label)}"><img src="${esc(WSG.imgSrc(x.src))}" alt="" loading="lazy"><span>${esc(x.label)}</span></button>`)
              .join("")}</div>`
          )
          .join("")}
        <div class="ed-dialog-btns"><button class="ed-btn ed-btn-ghost" data-cancel>Cancel</button></div>`);
      d.querySelector(".ed-dialog-card").classList.add("wide");
      d.addEventListener("click", (e) => {
        const b = e.target.closest("[data-src]");
        if (b || e.target.closest("[data-cancel]") || e.target === d) {
          d.remove();
          res(b ? b.dataset.src : null);
        }
      });
    });
  }
  function askText(title, text, ph) {
    return new Promise((res) => {
      const d = dialog(`<h3>${esc(title)}</h3><p>${esc(text)}</p><input type="text" maxlength="40" placeholder="${esc(ph || "")}"><div class="ed-dialog-btns"><button class="ed-btn ed-btn-ghost" data-v="0">Cancel</button><button class="ed-btn ed-btn-navy" data-v="1">Save</button></div>`);
      const inp = d.querySelector("input");
      setTimeout(() => inp.focus(), 40);
      const finish = (ok) => {
        d.remove();
        res(ok ? inp.value.trim() : null);
      };
      inp.addEventListener("keydown", (e) => e.key === "Enter" && finish(true));
      d.addEventListener("click", (e) => {
        const b = e.target.closest("[data-v]");
        if (b) finish(b.dataset.v === "1");
        else if (e.target === d) finish(false);
      });
    });
  }

  /* ================= dialogs ================= */
  function dialog(html) {
    const d = el("div", { class: "ed-dialog", role: "dialog", "aria-modal": "true" }, `<div class="ed-dialog-card">${html}</div>`);
    document.body.appendChild(d);
    const first = d.querySelector("input, button");
    if (first) setTimeout(() => first.focus(), 30);
    return d;
  }
  function confirmBox(title, text) {
    return new Promise((res) => {
      const d = dialog(`<h3>${esc(title)}</h3><p>${esc(text || "")}</p><div class="ed-dialog-btns"><button class="ed-btn ed-btn-ghost" data-v="0">Cancel</button><button class="ed-btn ed-btn-navy" data-v="1">Yes</button></div>`);
      d.addEventListener("click", (e) => {
        const b = e.target.closest("[data-v]");
        if (!b && e.target !== d) return;
        d.remove();
        res(b ? b.dataset.v === "1" : false);
      });
    });
  }
  let toastTimer = 0;
  function toast(msg, bad) {
    let t = $("#edToast");
    if (!t) {
      t = el("div", { id: "edToast", class: "ed-toast", role: "status" });
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.toggle("bad", !!bad);
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), bad ? 6000 : 3500);
  }
  Ed.toast = toast;
  Ed._test = { compress, uploadImage, lock, unlock };
  function busy(on, text) {
    let b = $("#edBusy");
    if (on) {
      if (!b) {
        b = el("div", { id: "edBusy", class: "ed-busy" }, `<div><span class="ed-spin"></span><b></b></div>`);
        document.body.appendChild(b);
      }
      $("b", b).textContent = text || "Working…";
    } else if (b) b.remove();
  }

  /* ---------- login ---------- */
  async function startLogin() {
    const auth = await fetchAuth();
    if (!auth && !isLocal) return setupDialog();
    const d = dialog(`
      <h3>Edit the site</h3>
      <p>Enter the editor or advisor passcode.</p>
      <form id="lgForm">
        <input type="password" id="lgPass" autocomplete="current-password" placeholder="Passcode" ${auth ? "" : "disabled"}>
        <p class="ed-err" id="lgErr"></p>
        <div class="ed-dialog-btns">
          <button type="button" class="ed-btn ed-btn-ghost" data-cancel>Cancel</button>
          <button type="submit" class="ed-btn ed-btn-navy" ${auth ? "" : "disabled"}>Unlock</button>
        </div>
      </form>
      ${!auth ? `<p class="ed-note">Editing isn't set up on this site yet.</p><button type="button" class="ed-btn ed-btn-soft" data-setup>Set up editing</button>` : ""}
      ${isLocal ? `<hr><p class="ed-note">You're previewing on this computer.</p><button type="button" class="ed-btn ed-btn-soft" data-test>Edit this preview copy (doesn't touch the live site)</button>` : ""}`);
    d.addEventListener("click", (e) => {
      if (e.target.closest("[data-cancel]") || e.target === d) d.remove();
      if (e.target.closest("[data-setup]")) {
        d.remove();
        setupDialog();
      }
      if (e.target.closest("[data-test]")) {
        d.remove();
        begin({ role: "adviser", test: true, owner: "test", repo: "test", branch: "main", token: "" });
        if (!localStorage.getItem("wsg-test-auth")) toast("Preview copy: nothing here goes to the live site.");
      }
    });
    const form = $("#lgForm", d);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const pass = $("#lgPass", d).value;
      if (!pass || !auth) return;
      $("#lgErr", d).textContent = "Checking…";
      let role = null,
        secret = await unlock(auth.adviser, pass);
      if (secret) role = "adviser";
      else if ((secret = await unlock(auth.editor, pass))) role = "editor";
      if (!secret) {
        $("#lgErr", d).textContent = "That passcode didn't work.";
        return;
      }
      d.remove();
      begin({ role, test: false, owner: auth.owner, repo: auth.repo, branch: auth.branch || "main", token: secret.token });
    });
  }
  function setupDialog() {
    const g = guessRepo();
    const d = dialog(`
      <h3>Set up editing</h3>
      <p>This is a one-time step. The README in the GitHub repository explains how to make the GitHub key.</p>
      <form id="suForm" class="ed-form">
        <div class="ed-row"><div class="ed-label">GitHub account</div><input id="suOwner" value="${esc(g.owner)}" required></div>
        <div class="ed-row"><div class="ed-label">Repository</div><input id="suRepo" value="${esc(g.repo)}" required></div>
        <div class="ed-row"><div class="ed-label">GitHub key<small>A fine-grained personal access token with Contents: Read and write for this repository only.</small></div><input id="suTok" type="password" autocomplete="off" required></div>
        <div class="ed-row"><div class="ed-label">Editor passcode<small>For officers and chairs. At least 12 characters; a few random words works great.</small></div><input id="suEd" type="text" autocomplete="off" required minlength="12"></div>
        <div class="ed-row"><div class="ed-label">Advisor passcode<small>Different from the editor passcode.</small></div><input id="suAd" type="text" autocomplete="off" required minlength="12"></div>
        <p class="ed-err" id="suErr"></p>
        <div class="ed-dialog-btns"><button type="button" class="ed-btn ed-btn-ghost" data-cancel>Cancel</button><button type="submit" class="ed-btn ed-btn-navy">Save and start editing</button></div>
      </form>`);
    d.addEventListener("click", (e) => {
      if (e.target.closest("[data-cancel]") || e.target === d) d.remove();
    });
    $("#suForm", d).addEventListener("submit", async (e) => {
      e.preventDefault();
      const s = { role: "adviser", test: false, owner: $("#suOwner", d).value.trim(), repo: $("#suRepo", d).value.trim(), branch: "main", token: $("#suTok", d).value.trim() };
      const ed = $("#suEd", d).value.trim(),
        ad = $("#suAd", d).value.trim();
      const err = $("#suErr", d);
      if (ed === ad) return (err.textContent = "The two passcodes need to be different.");
      err.textContent = "Checking the GitHub key…";
      const ok = await checkToken(s);
      if (ok !== true) return (err.textContent = ok);
      try {
        const repo = await gh("GET", "", null, s);
        s.branch = repo.default_branch || "main";
        err.textContent = "Saving…";
        const secret = { token: s.token };
        const auth = { version: 1, owner: s.owner, repo: s.repo, branch: s.branch, editor: await lock(secret, ed), adviser: await lock(secret, ad) };
        session = s;
        await saveAuth(auth);
        d.remove();
        begin(s);
        toast("Editing is set up. Write the passcodes down somewhere safe.");
      } catch (e2) {
        err.textContent = "Couldn't save: " + e2.message;
      }
    });
  }
  async function begin(s) {
    session = s;
    WSG.editMode = true;
    try {
      baseSha = await store.sha("data/site.json");
    } catch (_) {
      baseSha = null;
    }
    saveSession();
    buildShell();
    updateBar();
    WSG.refresh();
    openPanel({ tab: "site", id: null });
  }

  /* ---------- publish ---------- */
  async function publish() {
    if (!dirty) return toast("Everything is already published.");
    busy(true, "Publishing…");
    try {
      const current = await store.sha("data/site.json");
      if (baseSha && current && current !== baseSha && !session.test) {
        busy(false);
        const go = await confirmBox(
          "Someone else published changes",
          "Another editor published since you started. If you publish now, your version replaces theirs. Download a backup first if you're not sure."
        );
        if (!go) return;
        busy(true, "Publishing…");
      }
      const clean = JSON.parse(JSON.stringify(D(), (k, v) => (k.startsWith("_") ? undefined : v)));
      const res = await store.put("data/site.json", utf8b64(JSON.stringify(clean, null, 1)), `Site update by ${session.role}`, current);
      baseSha = res && res.content ? res.content.sha : null;
      dirty = false;
      clearDraft();
      saveSession();
      updateBar();
      busy(false);
      toast(session.test ? "Saved to the preview copy on this computer." : "Published! The live site updates in about a minute.");
    } catch (e) {
      busy(false);
      toast(e.status === 401 ? "The GitHub key stopped working. An adviser can add a new one in Settings." : "Publish failed: " + e.message, true);
    }
  }

  /* ================= page hooks ================= */
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-open-editor]")) {
      e.preventDefault();
      if (WSG.editMode) openPanel();
      else startLogin();
      return;
    }
    const p = e.target.closest(".edit-pin");
    if (p) {
      e.preventDefault();
      e.stopPropagation();
      WSG.closeModal();
      const [kind, id, extra] = p.dataset.edit.split(":");
      const map = {
        site: { tab: "site" },
        home: { tab: "site" },
        banner: { tab: "banner" },
        scores: { tab: "scores" },
        events: { tab: "events" },
        event: { tab: "events", id },
        committees: { tab: "committees" },
        committee: { tab: "committees", id, focus: extra },
        people: { tab: "people" },
        page: { tab: "pages", id },
      };
      openPanel({ id: null, ...(map[kind] || { tab: "site" }) });
    }
  });
  window.addEventListener("beforeunload", (e) => {
    if (WSG.editMode && dirty && !session.test) {
      saveDraft();
    }
  });
})();
