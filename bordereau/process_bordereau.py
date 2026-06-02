#!/usr/bin/env python3
"""
process_bordereau.py — Modifie un bordereau Colissimo PDF (template RTS)
Usage: python3 process_bordereau.py <nouveau_numero_suivi> <chemin_sortie.pdf>
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

# Zone du barcode image (déterminée par analyse — couvre tous les strips)
BARCODE_RECT = fitz.Rect(54, 327, 342, 442)


def format_barcode_label(tracking: str) -> str:
    """'6A05681027840' → '116A 05681027840D'"""
    prefix = tracking[:2]
    digits = tracking[2:]
    return f"11{prefix} {digits}D"


def generate_barcode_png(tracking: str, width_pt: float, height_pt: float) -> bytes:
    """Code 128 rectangulaire (sans texte en-dessous), retourne bytes PNG."""
    CODE128 = barcode.get_barcode_class('code128')
    buf = io.BytesIO()
    bc = CODE128(tracking, writer=ImageWriter())
    bc.write(buf, options={
        'module_width': 0.22,
        'module_height': 11.0,
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

    target_w = int(width_pt * 150 / 72)
    target_h = int(height_pt * 150 / 72)
    img = img.resize((target_w, target_h), Image.LANCZOS)

    out = io.BytesIO()
    img.save(out, format='PNG')
    return out.getvalue()


def process(template_path: str, new_tracking: str, output_path: str) -> None:
    new_label = format_barcode_label(new_tracking)

    doc = fitz.open(template_path)
    page = doc[0]

    # ── 1. Localiser les textes existants ─────────────────────────────────
    tracking_rects = page.search_for(OLD_TRACKING)
    label_rects    = page.search_for(OLD_BARCODE_LABEL)

    if not tracking_rects:
        tracking_rects = [fitz.Rect(96, 195, 165, 212)]
        print("⚠ tracking text not found, using fallback position", file=sys.stderr)
    if not label_rects:
        label_rects = [fitz.Rect(59, 271, 255, 304)]
        print("⚠ barcode label not found, using fallback position", file=sys.stderr)

    # ── 2. Masquer les textes + zone barcode ──────────────────────────────
    for r in tracking_rects:
        page.add_redact_annot(r, fill=(1, 1, 1))
    for r in label_rects:
        page.add_redact_annot(r, fill=(1, 1, 1))
    page.add_redact_annot(BARCODE_RECT, fill=(1, 1, 1))

    page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_REMOVE)

    # ── 3. Insérer le nouveau numéro de colis ─────────────────────────────
    for r in tracking_rects:
        page.insert_text(
            fitz.Point(r.x0, r.y1),
            new_tracking,
            fontname="cour",
            fontsize=8,
            color=(0, 0, 0),
        )

    # ── 4. Insérer le nouveau label barcode (centré dans la zone) ─────────
    for r in label_rects:
        # Calcul fontsize pour tenir dans la largeur (Courier = 0.6em par char)
        max_fs = int((r.width * 0.95) / (len(new_label) * 0.6))
        fs = min(max_fs, 20)  # ne pas dépasser le font original
        # Centrage horizontal
        char_w = fs * 0.6
        text_w = len(new_label) * char_w
        x0 = r.x0 + (r.width - text_w) / 2
        page.insert_text(
            fitz.Point(x0, r.y1),
            new_label,
            fontname="cour",
            fontsize=fs,
            color=(0, 0, 0),
        )

    # ── 5. Générer et insérer le barcode Code 128 ─────────────────────────
    bc_png = generate_barcode_png(new_tracking, BARCODE_RECT.width, BARCODE_RECT.height)
    page.insert_image(BARCODE_RECT, stream=bc_png, keep_proportion=False)

    # ── 6. Sauvegarder ────────────────────────────────────────────────────
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    doc.save(output_path, deflate=True, garbage=4)
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
