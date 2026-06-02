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

# Métriques Helvetica-Bold (fraction de la taille)
_FONT_HEB  = fitz.Font("hebo")
ASC_RATIO  = _FONT_HEB.ascender          # ≈ 1.07
DESC_RATIO = abs(_FONT_HEB.descender)    # ≈ 0.307
CAP_RATIO  = 0.72                        # hauteur des majuscules ≈ 72 % de la taille

# Positions des séparateurs trouvées par analyse (y PDF, origine haut-gauche)
SEP_NUM_COLIS = 199.0    # ligne horizontale au-dessus de "6A05681027840"
SEP_LABEL     = 281.5    # ligne horizontale dans la zone "116A..."
SEP_BARCODE_Y = 350.65   # ligne épaisse en haut de la zone barcode
SEP_BARCODE   = (74.27, 350.65, 320.88, 350.65)   # (x0,y0,x1,y1)
SEP_BARCODE_W = 1.7

# Zone image barcode : on insère SOUS le séparateur y=351
BARCODE_RECT = fitz.Rect(74, 353, 321, 427)


def format_label(tracking: str) -> str:
    """'6A05681027840' → '116A 05681027840D'"""
    return f"11{tracking[:2]} {tracking[2:]}D"


def generate_barcode_png(tracking: str, width_pt: float, height_pt: float) -> bytes:
    """Code 128 barres fines, retourne PNG bytes."""
    CODE128 = barcode.get_barcode_class("code128")
    buf = io.BytesIO()
    CODE128(tracking, writer=ImageWriter()).write(buf, options={
        "module_width":  0.25,   # barres fines
        "module_height": 10.0,
        "quiet_zone":    2.0,
        "write_text":    False,
        "font_size":     0,
        "text_distance": 0,
        "background":    "white",
        "foreground":    "black",
        "dpi":           300,
    })
    buf.seek(0)
    img = Image.open(buf).convert("RGB")
    # Dimensionner à la zone cible sans déformer les barres
    target_w = int(width_pt  * 300 / 72)
    target_h = int(height_pt * 300 / 72)
    img = img.resize((target_w, target_h), Image.LANCZOS)
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def find_span(page, target_text):
    """Retourne le span rawdict du texte cible, ou None."""
    for b in page.get_text("rawdict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]:
        for line in b.get("lines", []):
            for span in line.get("spans", []):
                chars = span.get("chars", [])
                t = "".join(c.get("c", "") for c in chars).strip()
                if t == target_text:
                    return span
    return None


def replace_text(page, span, new_text):
    """
    Remplace un texte dans le PDF :
    - rect blanc couvrant uniquement le corps des caractères
      (entre le haut des majuscules et le bas des descendantes)
    - Nouveau texte par-dessus en Helvetica-Bold
    """
    ox, oy = span["origin"]
    size   = span["size"]
    bbox   = span["bbox"]

    cap_h  = CAP_RATIO  * size     # hauteur des majuscules
    desc   = DESC_RATIO * size     # descendante

    # Rect blanc : depuis le haut des majuscules jusqu'au bas des descendantes
    # On ajoute 0.5pt de marge pour couvrir l'antialiasing
    white = fitz.Rect(
        bbox[0],
        oy - cap_h - 0.5,
        bbox[2],
        oy + desc + 0.5,
    )
    page.draw_rect(white, fill=(1, 1, 1), color=None, overlay=True)
    page.insert_text(fitz.Point(ox, oy), new_text,
                     fontname="hebo", fontsize=size, color=(0, 0, 0))


def redraw_hline(page, x0, y0, x1, y1, width, color=(0, 0, 0)):
    """Redessine une ligne horizontale par-dessus le contenu ajouté."""
    page.draw_line(fitz.Point(x0, y0), fitz.Point(x1, y1),
                   color=color, width=width)


def process(new_tracking: str, output_path: str) -> None:
    if not os.path.exists(TEMPLATE_PATH):
        print(f"Template introuvable : {TEMPLATE_PATH}", file=sys.stderr)
        sys.exit(1)

    new_label = format_label(new_tracking)
    doc  = fitz.open(TEMPLATE_PATH)
    page = doc[0]

    # ── 1. Numéro de colis (size=8, Helvetica-Bold) ───────────────────────
    span = find_span(page, OLD_TRACKING)
    if span:
        replace_text(page, span, new_tracking)
        # Le séparateur à y=199 est AU-DESSUS du haut des majuscules
        # (caps_top ≈ 200.5 > 199) → il n'est PAS couvert par le rect blanc ✓

    # ── 2. Label barcode "116A..." (size=20, Helvetica-Bold) ──────────────
    span = find_span(page, OLD_BARCODE_LABEL)
    if span:
        replace_text(page, span, new_label)
        # Le séparateur à y=281.5 est dans la zone du rect blanc → on le redessine
        redraw_hline(page, 57.0, SEP_LABEL, 339.9, SEP_LABEL, width=0.3)

    # ── 3. Image barcode ──────────────────────────────────────────────────
    # Pas de rect blanc : la zone a déjà un fond blanc dans le PDF original
    # On insère sous le séparateur y=351 (BARCODE_RECT commence à y=353)
    bc_png = generate_barcode_png(
        new_tracking, BARCODE_RECT.width, BARCODE_RECT.height
    )
    page.insert_image(BARCODE_RECT, stream=bc_png, keep_proportion=False)

    # Redessiner le séparateur épais au-dessus du barcode (couvert par l'image)
    redraw_hline(page, *SEP_BARCODE, width=SEP_BARCODE_W)

    # ── 4. Sauvegarder ────────────────────────────────────────────────────
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
