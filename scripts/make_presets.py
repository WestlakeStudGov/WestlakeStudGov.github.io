"""Draws the built-in preset pictures (assets/presets/*.svg) in the school colors.

Run from the site folder after changing a design:  python3 scripts/make_presets.py
Each picture comes in two backgrounds: navy and blue.
"""
import os

NAVY, NAVY2, NAVY3 = "#0D223F", "#152E52", "#21426F"
BLUE, BLUE2, SOFT = "#6CA9E2", "#9CC6EE", "#E1EEFA"
GOLD, GOLD2 = "#C5B683", "#E2D6A8"
W = "#FFFFFF"
OUT = "assets/presets"

BOLT = "M14 2 5 14h6l-2 8 10-13h-6z"  # same bolt as the site's logo mark (24x24)


def background(kind):
    if kind == "navy":
        g = f'<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{NAVY}"/><stop offset="1" stop-color="{NAVY3}"/></linearGradient>'
        glow = f'<radialGradient id="gl" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="{BLUE}" stop-opacity=".35"/><stop offset="1" stop-color="{BLUE}" stop-opacity="0"/></radialGradient>'
        stripes = f'<g transform="rotate(-28 1600 1000)"><rect x="1180" y="860" width="900" height="34" fill="{GOLD}"/><rect x="1180" y="912" width="900" height="16" fill="{BLUE}"/><rect x="-500" y="40" width="900" height="16" fill="{BLUE}" opacity=".7"/><rect x="-500" y="74" width="900" height="34" fill="{GOLD}" opacity=".9"/></g>'
        mark = f'<path d="{BOLT}" transform="translate(-60 380) scale(34)" fill="{W}" opacity=".04"/>'
    else:
        g = f'<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{BLUE2}"/><stop offset="1" stop-color="{BLUE}"/></linearGradient>'
        glow = f'<radialGradient id="gl" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="{W}" stop-opacity=".45"/><stop offset="1" stop-color="{W}" stop-opacity="0"/></radialGradient>'
        stripes = f'<g transform="rotate(-28 1600 1000)"><rect x="1180" y="860" width="900" height="34" fill="{NAVY}"/><rect x="1180" y="912" width="900" height="16" fill="{GOLD}"/><rect x="-500" y="40" width="900" height="16" fill="{GOLD}"/><rect x="-500" y="74" width="900" height="34" fill="{NAVY}" opacity=".85"/></g>'
        mark = f'<path d="{BOLT}" transform="translate(1180 -60) scale(30)" fill="{W}" opacity=".12"/>'
    return f'<defs>{g}{glow}</defs><rect width="1600" height="1000" fill="url(#bg)"/>{mark}{stripes}<circle cx="800" cy="500" r="430" fill="url(#gl)"/>'


def ball(fill, line, inner):
    return f'<circle r="230" fill="{fill}" stroke="{line}" stroke-width="14"/>{inner}'


def L(d, c, w=12, extra=""):
    return f'<path d="{d}" fill="none" stroke="{c}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round" {extra}/>'


ICONS = {
    "volleyball": lambda: ball(W, NAVY, "".join([
        L("M-30 -228 C 60 -120 70 30 0 120", NAVY), L("M0 120 C 90 140 180 110 226 40", NAVY),
        L("M0 120 C -70 170 -170 160 -214 80", NAVY), L("M-100 -205 C -20 -110 -30 20 -120 110", BLUE, 10),
        L("M60 -220 C 150 -150 200 -60 214 30", BLUE, 10), L("M-180 140 C -90 210 60 230 150 175", BLUE, 10)])),
    "basketball": lambda: ball(GOLD, NAVY, "".join([
        L("M0 -230 V230", NAVY), L("M-230 0 H230", NAVY),
        L("M-150 -175 C -70 -90 -70 90 -150 175", NAVY), L("M150 -175 C 70 -90 70 90 150 175", NAVY)])),
    "football": lambda: (f'<g transform="rotate(-30)"><ellipse rx="300" ry="175" fill="{GOLD}" stroke="{NAVY}" stroke-width="14"/>'
                         + L("M-210 -95 V95", W, 18) + L("M210 -95 V95", W, 18) + L("M-70 0 H70", W, 12)
                         + "".join(L(f"M{x} -22 V22", W, 12) for x in (-50, -17, 17, 50)) + "</g>"),
    "soccer": lambda: ball(W, NAVY, f'<path d="M0 -70 L67 -22 L41 57 L-41 57 L-67 -22Z" fill="{NAVY}"/>'
                           + "".join(f'<path d="M0 -70 L0 -150" stroke="{NAVY}" stroke-width="12" transform="rotate({a})"/>' for a in (0, 72, 144, 216, 288))
                           + "".join(f'<path d="M-45 -225 L45 -225 L60 -165 L0 -140 L-60 -165Z" fill="{NAVY}" transform="rotate({a})"/>' for a in (36, 108, 180, 252, 324))),
    "baseball": lambda: ball(W, NAVY, L("M-150 -175 C -60 -80 -60 80 -150 175", "#C8102E", 10, 'stroke-dasharray="2 22"') + L("M150 -175 C 60 -80 60 80 150 175", "#C8102E", 10, 'stroke-dasharray="2 22"')
                             + L("M-150 -175 C -60 -80 -60 80 -150 175", "#C8102E", 6) + L("M150 -175 C 60 -80 60 80 150 175", "#C8102E", 6)),
    "softball": lambda: ball(GOLD2, NAVY, L("M-150 -175 C -60 -80 -60 80 -150 175", "#C8102E", 8) + L("M150 -175 C 60 -80 60 80 150 175", "#C8102E", 8)
                             + L("M-150 -175 C -60 -80 -60 80 -150 175", "#C8102E", 12, 'stroke-dasharray="2 24"') + L("M150 -175 C 60 -80 60 80 150 175", "#C8102E", 12, 'stroke-dasharray="2 24"')),
    "tennis": lambda: ball("#D7E86A", NAVY, L("M-200 -110 C -60 -40 -60 40 -200 110", W, 16) + L("M200 -110 C 60 -40 60 40 200 110", W, 16)),
    "wrestling": lambda: (f'<ellipse rx="330" ry="150" fill="{NAVY2}" stroke="{BLUE}" stroke-width="16" transform="translate(0 60)"/>'
                          f'<ellipse rx="150" ry="68" fill="none" stroke="{GOLD}" stroke-width="12" transform="translate(0 60)"/>'
                          + L("M-30 60 H-8", W, 12) + L("M8 60 H30", W, 12)
                          + f'<path d="{BOLT}" transform="translate(-72 -250) scale(6)" fill="{GOLD}"/>'),
    "swim": lambda: (f'<circle cx="-60" cy="-40" r="58" fill="{GOLD}"/>' + L("M-260 30 C -170 -150 60 -190 190 -40", W, 34)
                     + "".join(L(f"M-330 {y} q 55 -44 110 0 t 110 0 t 110 0 t 110 0 t 110 0 t 110 0", c, 24) for y, c in ((70, W), (150, BLUE2), (230, W)))),
    "track": lambda: (f'<rect x="-330" y="-180" width="660" height="360" rx="180" fill="{BLUE}" stroke="{W}" stroke-width="8"/>'
                      + "".join(f'<rect x="{-330 + i * 30}" y="{-180 + i * 30}" width="{660 - i * 60}" height="{360 - i * 60}" rx="{180 - i * 30}" fill="none" stroke="{W}" stroke-width="5"/>' for i in (1, 2, 3))
                      + f'<rect x="-210" y="-60" width="420" height="120" rx="60" fill="{NAVY2}" stroke="{W}" stroke-width="8"/>'
                      + f'<rect x="40" y="60" width="22" height="120" fill="{GOLD}"/>'),
    "golf": lambda: (L("M40 220 V-230", W, 14) + f'<path d="M40 -230 L220 -170 L40 -110Z" fill="{GOLD}"/>'
                     + f'<ellipse cx="0" cy="225" rx="240" ry="34" fill="{NAVY2}" opacity=".6"/><circle cx="-110" cy="170" r="52" fill="{W}"/>'),
    "cheer": lambda: (f'<g transform="rotate(-18)"><path d="M-220 -70 L170 -190 L170 190 L-220 70Z" fill="{GOLD}" stroke="{NAVY}" stroke-width="14" stroke-linejoin="round"/>'
                      f'<rect x="-280" y="-80" width="70" height="160" rx="20" fill="{W}" stroke="{NAVY}" stroke-width="14"/>' + L("M-120 80 L-90 190", NAVY, 18) + "</g>"
                      + "".join(f'<path d="{BOLT}" transform="translate({x} {y}) scale(3)" fill="{W}"/>' for x, y in ((230, -230), (270, 80)))),
    "concert": lambda: (f'<path d="M-120 -170 L170 -230 V120" fill="none" stroke="{W}" stroke-width="26" stroke-linejoin="round"/>'
                        f'<path d="M-120 -170 V170" stroke="{W}" stroke-width="26"/><path d="M-120 -170 L170 -230 L170 -170 L-120 -110Z" fill="{W}"/>'
                        f'<ellipse cx="-180" cy="170" rx="70" ry="52" transform="rotate(-20 -180 170)" fill="{GOLD}"/>'
                        f'<ellipse cx="110" cy="120" rx="70" ry="52" transform="rotate(-20 110 120)" fill="{GOLD}"/>'),
    "dance": lambda: (f'<path d="M-260 -260 L-40 230 L180 230Z" fill="{W}" opacity=".16"/>'
                      f'<circle cx="-30" cy="-120" r="44" fill="{GOLD}"/>'
                      + L("M-30 -70 L-20 60", W, 26) + L("M-120 -150 L-30 -40 L110 -170", W, 22) + L("M-20 60 L-110 210", W, 22) + L("M-20 60 L110 150 L170 120", W, 22)
                      + "".join(f'<path d="M0 -40 L10 -10 L40 0 L10 10 L0 40 L-10 10 L-40 0 L-10 -10Z" transform="translate({x} {y}) scale({k})" fill="{GOLD}"/>' for x, y, k in ((220, -180, 1.6), (260, 40, 1), (-250, 60, 1.2)))),
    "theater": lambda: (f'<g transform="translate(-95 0) rotate(-12)"><path d="M-130 -170 H130 V40 C130 160 -130 160 -130 40Z" fill="{W}" stroke="{NAVY}" stroke-width="12"/>'
                        + L("M-80 -80 q 30 -30 60 0", NAVY, 14) + L("M20 -80 q 30 -30 60 0", NAVY, 14) + L("M-60 40 q 60 60 120 0", NAVY, 16) + "</g>"
                        + f'<g transform="translate(115 40) rotate(12)"><path d="M-130 -170 H130 V40 C130 160 -130 160 -130 40Z" fill="{GOLD}" stroke="{NAVY}" stroke-width="12"/>'
                        + L("M-80 -60 q 30 30 60 0", NAVY, 14) + L("M20 -60 q 30 30 60 0", NAVY, 14) + L("M-60 80 q 60 -60 120 0", NAVY, 16) + "</g>"),
    "community": lambda: (f'<path d="M0 -20 C -60 -110 -200 -70 -170 30 C -150 100 -60 150 0 200 C 60 150 150 100 170 30 C 200 -70 60 -110 0 -20Z" fill="{GOLD}" transform="translate(0 -90) scale(.8)"/>'
                          + "".join(f'<circle cx="{x}" cy="90" r="40" fill="{W}"/><path d="M{x - 66} 230 C {x - 66} 150 {x + 66} 150 {x + 66} 230Z" fill="{W}"/>' for x in (-170, 0, 170))),
    "school": lambda: (f'<path d="{BOLT}" transform="translate(-240 -255) scale(21)" fill="{GOLD}" stroke="{NAVY}" stroke-width=".5" stroke-linejoin="round"/>'),
    "christmas": lambda: (f'<rect x="-150" y="-140" width="300" height="350" rx="60" fill="{W}" fill-opacity=".22" stroke="{W}" stroke-width="14"/>'
                          f'<rect x="-120" y="-210" width="240" height="70" rx="16" fill="{GOLD}"/>'
                          + "".join(f'<circle cx="{x}" cy="{y}" r="34" fill="{GOLD}" stroke="{NAVY}" stroke-width="6"/>' for x, y in ((-60, 150), (20, 160), (90, 140), (-20, 100), (55, 90), (-80, 80)))
                          + f'<path d="M0 -40 L12 -12 L42 -10 L18 8 L26 38 L0 22 L-26 38 L-18 8 L-42 -10 L-12 -12Z" fill="{GOLD}" transform="translate(0 -30) scale(1.4)"/>'),
}

LABELS = {
    "volleyball": "Volleyball", "basketball": "Basketball", "football": "Football", "soccer": "Soccer",
    "baseball": "Baseball", "softball": "Softball", "tennis": "Tennis", "wrestling": "Wrestling", "swim": "Swim",
    "track": "Track", "golf": "Golf", "cheer": "Cheer & drill", "concert": "Concert", "dance": "Dance",
    "theater": "Theater", "community": "Community", "school": "Westlake bolt", "christmas": "Christmas Jars",
}


def main():
    os.makedirs(OUT, exist_ok=True)
    made = []
    for name, draw in ICONS.items():
        for kind in ("navy", "blue"):
            svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" width="1600" height="1000">'
                   f'{background(kind)}<circle cx="800" cy="500" r="345" fill="none" stroke="{GOLD}" stroke-width="6" opacity=".55"/>'
                   f'<circle cx="800" cy="500" r="372" fill="none" stroke="{GOLD}" stroke-width="2" opacity=".3"/>'
                   f'<g transform="translate(800 500) scale(1.18)">{draw()}</g></svg>')
            path = f"{OUT}/{name}-{kind}.svg"
            open(path, "w").write(svg)
            made.append(path)
    print(len(made), "presets written")


if __name__ == "__main__":
    main()
