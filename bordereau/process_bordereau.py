#!/usr/bin/env python3
"""
process_bordereau.py — Modifie un bordereau Colissimo RTS PDF
Usage: python3 process_bordereau.py <nouveau_numero_suivi> <chemin_sortie.pdf>
"""

import sys, os, io
import fitz
import barcode
from barcode.writer import ImageWriter
from PIL import Image

SCRIPT_DIR    = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_PATH = os.path.join(SCRIPT_DIR, "RTS COL BORDEREAU.pdf")

OLD_TRACKING      = "6A05681027840"
OLD_BARCODE_LABEL = "116A 05681027840D"
FR_COL_TEXT       = "FR-COL-1175-94RUN"

# Métriques Helvetica-Bold
_HEBO      = fitz.Font("hebo")
_HELV      = fitz.Font("helv")
DESC_HEBO  = abs(_HEBO.descender)   # ≈ 0.307
CAP_HEBO   = 0.72                   # hauteur majuscules / taille

# Séparateurs — positions exactes dans le template
#   y=199   : séparateur fin AU-DESSUS du num colis  → on l'évite (rect commence à y=200.5)
#   y=281.5 : séparateur au bord du label 116A       → on l'évite (rect commence à y=282)
#              NE PAS redessiner : coupe le QR code !
#   y=350.65: séparateur barcode                      → couvert par rect blanc, PAS redessiné

# Zone du barcode : même dimensions exactes que Im20 (xref=65, 422×162 à (92,344,303,425))
# Le rect blanc commence à x=58 et finit à x=339 pour NE PAS couvrir les bords
# verticaux du bordereau à x=56.8 (w=0.71) et x=340.2 (w=0.71).
BARCODE_WHITE  = fitz.Rect(58, 344, 339, 430)    # intérieur des bords → préserve les lignes
BARCODE_INSERT = fitz.Rect(92.00, 344.18, 303.26, 425.28)  # = Im20 exact (position originale)
BARCODE_PX     = (422, 162)                       # = Im20 exact (résolution originale)


def format_label(tracking: str) -> str:
    return f"11{tracking[:2]} {tracking[2:]}D"


def generate_barcode_png(tracking: str, target_px: tuple) -> bytes:
    """Code 128 — génère et resize exactement à target_px (w, h) pixels."""
    CODE128 = barcode.get_barcode_class("code128")
    buf = io.BytesIO()
    CODE128(tracking, writer=ImageWriter()).write(buf, options={
        "module_width":  0.25,    # barres fines
        "module_height": 10.0,
        "quiet_zone":    1.5,
        "write_text":    False,
        "font_size":     0,
        "text_distance": 0,
        "background":    "white",
        "foreground":    "black",
        "dpi":           300,
    })
    buf.seek(0)
    img = Image.open(buf).convert("RGB")
    img = img.resize(target_px, Image.LANCZOS)
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def find_span_rawdict(page, target):
    """Retourne le span rawdict du texte cible."""
    for b in page.get_text("rawdict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]:
        for line in b.get("lines", []):
            for span in line.get("spans", []):
                t = "".join(c.get("c", "") for c in span.get("chars", [])).strip()
                if t == target:
                    return span
    return None


def process(new_tracking: str, output_path: str) -> None:
    if not os.path.exists(TEMPLATE_PATH):
        print(f"Template introuvable : {TEMPLATE_PATH}", file=sys.stderr)
        sys.exit(1)

    new_label = format_label(new_tracking)
    doc  = fitz.open(TEMPLATE_PATH)
    page = doc[0]

    # ── Récupérer les spans AVANT modification ─────────────────────────────
    span_tracking = find_span_rawdict(page, OLD_TRACKING)
    span_label    = find_span_rawdict(page, OLD_BARCODE_LABEL)
    span_frcol    = find_span_rawdict(page, FR_COL_TEXT)

    # ── 1. Numéro de colis (Helvetica-Bold, size=8) ────────────────────────
    # Séparateur à y=199 est AU-DESSUS des majuscules (cap_top ≈ 200.5) → pas couvert
    if span_tracking:
        ox, oy = span_tracking["origin"]
        s      = span_tracking["size"]
        bbox   = span_tracking["bbox"]
        cap_h  = CAP_HEBO * s
        desc   = DESC_HEBO * s
        # Rect blanc : de la tête des majuscules jusqu'aux descendantes
        wr = fitz.Rect(bbox[0], oy - cap_h, bbox[2], oy + desc)
        page.draw_rect(wr, fill=(1, 1, 1), color=None, overlay=True)
        page.insert_text(fitz.Point(ox, oy), new_tracking,
                         fontname="hebo", fontsize=s, color=(0, 0, 0))

    # ── 2. Label barcode "116A 05681027840D" (Helvetica-Bold, size=20) ─────
    # Séparateur à y=281.5 → rect blanc commence à y=282 (juste en-dessous)
    # NE PAS redessiner y=281.5 : il couperait le QR code !
    if span_label:
        ox, oy = span_label["origin"]
        s      = span_label["size"]
        bbox   = span_label["bbox"]
        desc   = DESC_HEBO * s
        # Rect blanc depuis y=282 (sous le séparateur) jusqu'au bas des descendantes
        wr = fitz.Rect(bbox[0], 282, bbox[2], oy + desc)
        page.draw_rect(wr, fill=(1, 1, 1), color=None, overlay=True)
        page.insert_text(fitz.Point(ox, oy), new_label,
                         fontname="hebo", fontsize=s, color=(0, 0, 0))

    # ── 3. Redessiner FR-COL-1175-94RUN (couvert par le rect blanc ci-dessus) ──
    if span_frcol:
        ox_fr, oy_fr = span_frcol["origin"]
        s_fr         = span_frcol["size"]
        page.insert_text(fitz.Point(ox_fr, oy_fr), FR_COL_TEXT,
                         fontname="helv", fontsize=s_fr, color=(0, 0, 0))

    # ── 4. Image barcode ──────────────────────────────────────────────────
    # 4a. Rect blanc sur TOUTE la zone strips pour effacer les anciens barcode
    #     (commence à y=344 → sous le texte metadata "01/06/26..." à y=334-342)
    page.draw_rect(BARCODE_WHITE, fill=(1, 1, 1), color=None, overlay=True)

    # 4b. Nouveau barcode à la même taille que Im20 dans l'original (92→303, 344→425)
    bc_png = generate_barcode_png(new_tracking, BARCODE_PX)
    page.insert_image(BARCODE_INSERT, stream=bc_png, keep_proportion=False)
    # Aucun redraw de séparateur : le rect blanc couvre y=350.65 proprement.

    # ── 5. Sauvegarder ────────────────────────────────────────────────────
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    doc.save(output_path, deflate=True)
    doc.close()
    print(output_path)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python3 process_bordereau.py <new_tracking> <output_path>",
              file=sys.stderr)
        sys.exit(1)
    process(sys.argv[1].strip(), sys.argv[2].strip())
