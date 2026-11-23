// Reads the amount raised from each special page's donation link (SuccessFund)
// and saves it to data/total.json. Run every 30 minutes by .github/workflows/total.yml.
//
//   node scripts/update-total.mjs            reads the plain page (fast)
//   node scripts/update-total.mjs --browser  also opens the page in a real browser when the
//                                            plain page shows no amount or $0 (the amount can
//                                            load after the rest of the page does)
import { readFile, writeFile, appendFile } from "node:fs/promises";

const useBrowser = process.argv.includes("--browser");
const site = JSON.parse(await readFile("data/site.json", "utf8"));
let old = { pages: {} };
try {
  old = JSON.parse(await readFile("data/total.json", "utf8"));
} catch {}

const num = (s) => Number(String(s).replace(/[^0-9.]/g, ""));
function parse(raw) {
  const text = raw
    .replace(/<!--\s*-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&#36;|&dollar;/g, "$")
    .replace(/\s+/g, " ");
  let raised = null;
  let goal = null;
  let m = text.match(/\$\s?([\d,]+(?:\.\d+)?)\s*raised/i);
  if (m) raised = num(m[1]);
  m = text.match(/of\s*(?:our\s*)?\$\s?([\d,]+(?:\.\d+)?)\s*goal/i);
  if (m) goal = num(m[1]);
  if (raised == null) {
    m = raw.match(/totalRaised\\?",\s*(\d+(?:\.\d+)?)/);
    if (m) raised = num(m[1]);
  }
  return { raised, goal };
}
async function readPlain(url) {
  const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (site total updater)" } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return parse(await r.text());
}
let browser = null;
async function readBrowser(url) {
  if (!browser) {
    const { chromium } = await import("playwright");
    browser = await chromium.launch();
  }
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(3000);
    return parse(await page.evaluate(() => document.body.innerText));
  } finally {
    await page.close();
  }
}

const next = { pages: {} };
let changed = false;
let needBrowser = false;
for (const p of site.pages || []) {
  const prev = (old.pages || {})[p.slug];
  if (!p.autoTotal || !p.donateUrl) continue;
  let url = p.donateUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  let got = null;
  try {
    got = await readPlain(url);
  } catch (e) {
    console.log(`${p.slug}: plain page failed (${e.message})`);
  }
  if (!got || got.raised == null || got.raised === 0) {
    if (useBrowser) {
      try {
        const b = await readBrowser(url);
        if (b && b.raised != null) got = b;
      } catch (e) {
        console.log(`${p.slug}: browser failed (${e.message})`);
      }
    } else needBrowser = true;
  }
  if (!got || got.raised == null) {
    console.log(`${p.slug}: couldn't find the amount raised (keeping the last total)`);
    if (prev) next.pages[p.slug] = prev;
    continue;
  }
  const { raised, goal } = got;
  if (!prev || prev.raised !== raised || prev.goal !== goal) {
    next.pages[p.slug] = { raised, goal, updated: new Date().toISOString() };
    changed = true;
    console.log(`${p.slug}: $${raised} of $${goal}`);
  } else next.pages[p.slug] = prev;
}
if (browser) await browser.close();
const keys = (o) => JSON.stringify(Object.keys(o || {}).sort());
if (keys(next.pages) !== keys(old.pages)) changed = true;
if (changed) {
  await writeFile("data/total.json", JSON.stringify(next, null, 1) + "\n");
  console.log("Saved data/total.json");
} else console.log("No change");
// Tells the workflow whether to try again with a real browser
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `need_browser=${needBrowser}\n`);
