# Generates figures/count-apples.svg and its German translation (SPEC.md §6.8).
# Run from the bundle directory: python3 figures/src/count-apples.py
TEXTS = {
    "en": dict(title="Counting apples: one more each time",
               desc="Three apples in a row, numbered 1, 2 and 3. A fourth apple is added at the end and gets the number 4, one more than 3. Below: 3 + 1 = 4.",
               captions=["Three apples in a row.", "Count them: each apple gets the next number.", "One more apple: the next number is one more, 4."],
               more="one more"),
    "de": dict(title="Äpfel zählen: jedes Mal einer mehr",
               desc="Drei Äpfel in einer Reihe, nummeriert mit 1, 2 und 3. Am Ende kommt ein vierter Apfel dazu und bekommt die Zahl 4, eins mehr als 3. Darunter: 3 + 1 = 4.",
               captions=["Drei Äpfel in einer Reihe.", "Zähle sie: Jeder Apfel bekommt die nächste Zahl.", "Ein Apfel mehr: Die nächste Zahl ist eins mehr, 4."],
               more="einer mehr"),
}
START, ADDED = 3, 1
TOTAL = START + ADDED
assert TOTAL == 4  # the figure claims 3 + 1 = 4
XS = [50 + 70 * i for i in range(TOTAL)]   # apple centres, 70 units apart
AY, NY = 62, 122                            # apple row, number row


def apple(i, cls):
    x = XS[i]
    return (f'    <circle class="{cls}" cx="{x}" cy="{AY}" r="22"/>\n'
            f'    <path class="s-good w2" d="M{x} {AY - 22} q4 -10 12 -12"/>\n')


def figure(t):
    numbers = "".join(f'    <text class="t-l bold f-ink" x="{XS[i]}" y="{NY}" text-anchor="middle">{i + 1}</text>\n' for i in range(START))
    mid = (XS[START - 1] + XS[START]) / 2
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" role="img" aria-labelledby="count-apples-t count-apples-d" data-ptf-figure="1">
  <title id="count-apples-t">{t["title"]}</title>
  <desc id="count-apples-d">{t["desc"]}</desc>
  <defs><marker id="ptf-arrow-accent" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path class="f-accent" d="M0 0 L10 5 L0 10 z"/></marker></defs>
  <g data-step="1" data-caption="{t["captions"][0]}">
{"".join(apple(i, "s-warn f-warn-soft w2") for i in range(START))}  </g>
  <g data-step="2" data-caption="{t["captions"][1]}">
{numbers}  </g>
  <g data-step="3" data-caption="{t["captions"][2]}">
{apple(START, "s-accent f-accent-soft w2")}    <text class="t-l bold f-accent" x="{XS[START]}" y="{NY}" text-anchor="middle">{TOTAL}</text>
    <path class="s-accent w2" d="M{XS[START - 1] + 12} {NY + 8} Q{mid} {NY + 26} {XS[START] - 14} {NY + 8}" marker-end="url(#ptf-arrow-accent)"/>
    <text class="t-s f-accent" x="{mid}" y="{NY + 38}" text-anchor="middle">+{ADDED}, {t["more"]}</text>
    <text class="t math f-ink" x="110" y="{NY + 38}" text-anchor="middle">{START} + {ADDED} = {TOTAL}</text>
  </g>
</svg>
'''


for lang, t in TEXTS.items():
    with open("figures/count-apples.svg" if lang == "en" else f"figures/count-apples.{lang}.svg", "w", encoding="utf-8") as f:
        f.write(figure(t))
