#!/usr/bin/env python3
"""
process_bordereau.py — Modifie un bordereau Colissimo PDF (template RTS)
Usage: python3 process_bordereau.py <nouveau_numero_suivi> <chemin_sortie.pdf>

Stratégie : draw_rect blanc + insert_text (pas de redaction qui efface le contenu voisin)
"""

import sys
import os
import io

import fitz  # PyMuPDF
import barcode
from barcode.writer import ImageWriter
from PIL import Image

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

TEMPLATES = {
    "rts": os.path.join(SCRIPT_DIR, "RTS COL BORDEREAU.pdf"),
}

OLD_TRACKING      = "6A05681027840"
OLD_BARCODE_LABEL = "116A 05681027840D"

# Zone du barcode image : commence à y=343 pour préserver le texte metadata
# "01/06/26 08:20 AELGP_DN..." qui se trouve à y=333-342
BARCODE_RECT = fitz.Rect(54, 343, 342, 440)


def format_barcode_label(tracking: str) -> str:
    """'6A05681027840' → '116A 05681027840D'"""
    prefix = tracking[:2]
    digits = tracking[2:]
    return f"11{prefix} {digits}D"


def generate_barcode_png(tracking: str, width_pt: float, height_pt: float) -> bytes:
    """Code 128 rectangulaire sans texte en-dessous — retourne bytes PNG."""
    CODE128 = barcode.get_barcode_class('code128')
    buf = io.BytesIO()
    bc = CODE128(tracking, writer=ImageWriter())
    bc.write(buf, options={
        'module_width': 0.18,
        'module_height': 10.0,
        'quiet_zone': 2.0,
        'write_text': False,
        'font_size': 0,
        'text_distance': 0,
        'background': 'white',
        'foreground': 'black',
        'dpi': 300,
    })
    buf.seek(0)
    img = Image.open(buf).convert('RGB')

    # Dimensionner exactement à la zone cible (150 dpi)
    target_w = int(width_pt  * 150 / 72)
    target_h = int(height_pt * 150 / 72)
    img = img.resize((target_w, target_h), Image.LANCZOS)

    out = io.BytesIO()
    img.save(out, format='PNG')
    return out.getvalue()


def process(template_path: str, new_tracking: str, output_path: str) -> None:
    new_label = format_barcode_label(new_tracking)

    doc = fitz.open(template_path)
    page = doc[0]

    # ── 1. Num colis : couvrir l'ancien + réécrire ────────────────────────
    # Font original : Helvetica-Bold size=8
    for r in page.search_for(OLD_TRACKING):
        page.draw_rect(r, color=None, fill=(1, 1, 1), overlay=True)
        page.insert_text(
            fitz.Point(r.x0, r.y1),
            new_tracking,
            fontname="hebo",   # Helvetica-Bold
            fontsize=8,
            color=(0, 0, 0),
        )

    # ── 2. Label barcode : couvrir l'ancien + réécrire ────────────────────
    # Font original : Helvetica-Bold size=20
    # NB : FR-COL-1175-94RUN overlap avec cette zone mais N'EST PAS redacté —
    # on peint juste par-dessus sans toucher les objets PDF existants.
    for r in page.search_for(OLD_BARCODE_LABEL):
        page.draw_rect(r, color=None, fill=(1, 1, 1), overlay=True)
        page.insert_text(
            fitz.Point(r.x0, r.y1),
            new_label,
            fontname="hebo",   # Helvetica-Bold
            fontsize=20,
            color=(0, 0, 0),
        )

    # ── 3. Image barcode : couvrir les anciennes barres + insérer la nouvelle
    # La zone commence à y=343 (en-dessous du texte "01/06/26 08:20...")
    page.draw_rect(BARCODE_RECT, color=None, fill=(1, 1, 1), overlay=True)
    bc_png = generate_barcode_png(new_tracking, BARCODE_RECT.width, BARCODE_RECT.height)
    page.insert_image(BARCODE_RECT, stream=bc_png, keep_proportion=False)

    # ── 4. Sauvegarder ────────────────────────────────────────────────────
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    doc.save(output_path, deflate=True)
    doc.close()
    print(output_path)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python3 process_bordereau.py <new_tracking> <output_path>", file=sys.stderr)
        sys.exit(1)

    new_tracking  = sys.argv[1].strip()
    output_path   = sys.argv[2].strip()
    template_path = TEMPLATES["rts"]

    if not os.path.exists(template_path):
        print(f"Template introuvable : {template_path}", file=sys.stderr)
        sys.exit(1)

    process(template_path, new_tracking, output_path)
