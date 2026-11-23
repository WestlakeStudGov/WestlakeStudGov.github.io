"""Pulls events from the Westlake High calendar into data/school-events.json.

Runs once a day on GitHub (.github/workflows/school-events.yml). It keeps only
events worth promoting to the community:
  - home games ("vs" games at Westlake)
  - concerts and shows
  - community nights
and leaves out away games, A/B days, tryouts, field trips, meetings and so on.
Each event gets a matching preset picture (volleyball, concert, ...).

The calendar link lives in data/site.json under site.schoolCalendar.url, so it
can be changed in edit mode. Editors can hide any school event in edit mode.

Run by hand from the site folder:  python3 scripts/import_school_events.py
"""
import datetime as dt
import json
import re
import sys
import urllib.request

DEFAULT_URL = "https://thrillshare-cmsv2.services.thrillshare.com/api/v4/o/28516/cms/events/generate_ical?filter_ids&section_ids"
DAYS_AHEAD = 150

SPORTS = [
    ("basketball", r"basketball"),
    ("volleyball", r"volleyball"),
    ("football", r"football"),
    ("soccer", r"soccer"),
    ("wrestling", r"wrestl"),
    ("swim", r"swim|dive|diving"),
    ("baseball", r"baseball"),
    ("softball", r"softball"),
    ("track", r"track|cross country"),
    ("tennis", r"tennis"),
    ("golf", r"golf"),
    ("lacrosse", r"lacrosse"),
    ("cheer", r"cheer|drill"),
]
ARTS = [
    ("dance", r"dance concert|ballroom|dance company"),
    ("concert", r"concert|band\b|choir|orchestra|madrigal|recital|symphony"),
    ("theater", r"\bshow\b|musical|\bplay\b|theat|showcase|one.?acts?"),
]
COMMUNITY = r"community|festival|carnival|zero fatalities|open house|parent night|family night|fair\b|celebration of|night of"

# Never import these
SKIP = (
    r"\b[ab] day\b|attendance school|tryout|field trip|board meeting|faculty|teacher|\bscc\b|testing|wida|"
    r"@ ?lunch|banquet|pictures|moratorium|minimal day|\bterm\b|pd day|work day|meeting|audition|rehearsal|"
    r"practice|clinic|camp\b|registration|physicals|hydration|weight cert|honor roll|graduation practice|"
    r"no school|holiday|\bbreak\b|\bdance\b(?! concert)|sadies|\bprom\b|homecoming|\bball\b"
)
# Locations that mean "at Westlake"
HOME_PLACE = r"westlake|main gym|aux gym|gym\b|field|stadium|court|track|commons|auditorium|thunder|whole building|range|room|c\d{3}"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (WSG site school calendar)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")


def unfold(text):
    return re.sub(r"\r?\n[ \t]", "", text).replace("\r", "")


def unescape(v):
    return v.replace("\\n", "\n").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\").strip()


def to_local(v, is_date):
    """ICS value -> our format: 2026-12-01 or 2026-12-01T15:00 (school's local time)."""
    if is_date or len(v) == 8:
        return f"{v[0:4]}-{v[4:6]}-{v[6:8]}"
    m = re.match(r"(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})", v)
    if not m:
        return ""
    y, mo, d, h, mi = (int(x) for x in m.groups())
    t = dt.datetime(y, mo, d, h, mi)
    if v.endswith("Z"):  # UTC: shift to Utah time (MST/MDT)
        dst = dt.datetime(y, 3, 8) <= t.replace(tzinfo=None) < dt.datetime(y, 11, 1)
        t = t - dt.timedelta(hours=6 if dst else 7)
    return t.strftime("%Y-%m-%dT%H:%M")


def parse(text):
    out = []
    for block in re.findall(r"BEGIN:VEVENT\n(.*?)END:VEVENT", unfold(text), re.S):
        ev = {}
        for line in block.split("\n"):
            if ":" not in line:
                continue
            key, val = line.split(":", 1)
            name = key.split(";")[0]
            ev[name] = (val, "VALUE=DATE" in key)
        out.append(ev)
    return out


def classify(title, place):
    t = title.lower()
    if re.search(SKIP, t, re.I):
        return None
    if re.search(r"@|\bto [A-Z]", title):  # away or travel ("Choir to Temple Square", "Cheer @ ...")
        return None
    home_game = re.search(r"\bvs\.?\b|\bversus\b", t) and (not place or re.search(HOME_PLACE, place, re.I))
    for cat, rx in SPORTS:
        if re.search(rx, t) and home_game:
            return cat
    if place and not re.search(HOME_PLACE, place, re.I):  # shows somewhere else
        return None
    for cat, rx in ARTS:
        if re.search(rx, t):
            return cat
    if re.search(COMMUNITY, t):
        return "community"
    return None


def main():
    site = json.load(open("data/site.json"))
    cfg = (site.get("site") or {}).get("schoolCalendar") or {}
    if cfg.get("on") is False:
        print("School calendar import is turned off in edit mode.")
        return
    url = (cfg.get("url") or DEFAULT_URL).strip()
    try:
        raw = fetch(url)
    except Exception as e:  # keep the last list if the school site is down
        print("Couldn't read the school calendar:", e)
        return
    today = dt.date.today()
    last = today + dt.timedelta(days=DAYS_AHEAD)
    picked = {}
    for ev in parse(raw):
        title = unescape(ev.get("SUMMARY", ("", False))[0])
        sv, sd = ev.get("DTSTART", ("", False))
        if not title or not sv:
            continue
        start = to_local(sv, sd)
        day = dt.date.fromisoformat(start[:10])
        if day < today - dt.timedelta(days=1) or day > last:
            continue
        place = unescape(ev.get("LOCATION", ("", False))[0])
        cat = classify(title, place)
        if not cat:
            continue
        ev_end, ed = ev.get("DTEND", ("", False))
        end = to_local(ev_end, ed) if ev_end else ""
        if ed and end:  # all-day end dates are the day after; make it the last day
            e = dt.date.fromisoformat(end) - dt.timedelta(days=1)
            end = "" if e <= day else e.isoformat()
        uid = re.sub(r"[^a-zA-Z0-9]", "", ev.get("UID", (title + start, False))[0])[:24]
        key = (re.sub(r"\W", "", title.lower()), start[:10])
        if key in picked:  # same show twice in one day: keep the first time
            continue
        desc = unescape(ev.get("DESCRIPTION", ("", False))[0])
        picked[key] = {
            "id": "whs-" + uid,
            "title": title,
            "start": start,
            "end": end,
            "location": place.title() if place.islower() else place,
            "description": desc[:400],
            "category": cat,
        }
    # The same show on several nights (like a musical) becomes one event with more dates
    events = []
    by_title = {}
    for e in sorted(picked.values(), key=lambda e: e["start"]):
        k = re.sub(r"\W", "", e["title"].lower())
        prev = by_title.get(k)
        if prev:
            last_day = (prev["moreDates"][-1]["date"] if prev["moreDates"] else prev["start"][:10])
            gap = (dt.date.fromisoformat(e["start"][:10]) - dt.date.fromisoformat(last_day)).days
            if 0 < gap <= 7:
                prev["moreDates"].append({"date": e["start"][:10]})
                continue
        e["moreDates"] = []
        by_title[k] = e
        events.append(e)
    data = {"source": url, "updated": dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"), "events": events}
    old = None
    try:
        old = json.load(open("data/school-events.json"))
    except Exception:
        pass
    if old and old.get("events") == events:
        print(f"No change ({len(events)} school events).")
        return
    with open("data/school-events.json", "w") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print(f"Saved {len(events)} school events.")


if __name__ == "__main__":
    sys.exit(main())
