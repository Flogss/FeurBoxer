#!/usr/bin/env python3
"""
process_bordereau.py — Modifie un bordereau Colissimo RTS PDF
Usage: python3 process_bordereau.py <nouveau_numero_suivi> <chemin_sortie.pdf>
"""

import sys, os, io, json
import fitz
import barcode
from barcode.writer import ImageWriter
from PIL import Image

SCRIPT_DIR    = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_PATH = os.path.join(SCRIPT_DIR, "RTS COL BORDEREAU.pdf")

OLD_TRACKING      = "6A05681027840"
OLD_BARCODE_LABEL = "116A 05681027840D"
FR_COL_TEXT       = "FR-COL-1175-94RUN"

# Bloc expéditeur / point relais (gauche du bordereau).
# Valeur par défaut (= texte du template) → (fontname, taille).
# L'ordre suit la clé envoyée par l'admin. On ne réécrit un champ que s'il
# diffère du défaut (sinon le template d'origine est déjà correct).
SENDER_FIELDS = {
    "relais":   ("RELAIS PICKUP",     "hebo", 12),
    "enseigne": ("FRANPRIX",          "hebo", 10),
    "name":     ("ARTHUR HAIAT",      "helv",  9),
    "street":   ("1 RUE TRAVERSIERE", "hebo", 12),
    "city":     ("94150 RUNGIS",      "hebo", 13),
}
# Limite droite du rectangle blanc : le bloc est borné par une boîte
# (x57→244.6) et un séparateur vertical à x≈245 — on reste sous 240.
SENDER_RIGHT_MAX = 240.0

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


def apply_sender_overrides(page, sender: dict) -> None:
    """Réécrit les champs du bloc expéditeur modifiés par l'admin.

    Deux passes : on blanchit d'abord TOUS les anciens textes, puis on pose
    les nouveaux par-dessus. Sinon le rectangle blanc d'une ligne effacerait
    le texte de la ligne voisine (interligne serré dans le template).
    Hauteur du rectangle basée sur la cap-height (et non la bbox, trop haute).
    """
    changed = []
    for key, (default, fontname, size) in SENDER_FIELDS.items():
        val = (sender.get(key) or "").strip()
        if val and val != default:
            span = find_span_rawdict(page, default)
            if span:
                changed.append((span, val, fontname, size))

    # Passe 1 — blanchir les anciens textes
    for span, val, fontname, size in changed:
        ox, oy = span["origin"]
        bbox   = span["bbox"]
        font   = _HEBO if fontname == "hebo" else _HELV
        new_w  = font.text_length(val, size)
        right  = min(SENDER_RIGHT_MAX, max(bbox[2], ox + new_w) + 2)
        cap, desc = 0.72 * size, 0.20 * size
        wr = fitz.Rect(bbox[0] - 1, oy - cap - 1, right, oy + desc + 1)
        page.draw_rect(wr, fill=(1, 1, 1), color=None, overlay=True)

    # Passe 2 — poser les nouvelles valeurs (toujours au-dessus des rectangles)
    for span, val, fontname, size in changed:
        ox, oy = span["origin"]
        page.insert_text(fitz.Point(ox, oy), val,
                         fontname=fontname, fontsize=size, color=(0, 0, 0))


def process(new_tracking: str, output_path: str, sender: dict | None = None) -> None:
    if not os.path.exists(TEMPLATE_PATH):
        print(f"Template introuvable : {TEMPLATE_PATH}", file=sys.stderr)
        sys.exit(1)

    new_label = format_label(new_tracking)
    doc  = fitz.open(TEMPLATE_PATH)
    page = doc[0]

    # ── 0. Expéditeur / point relais — uniquement les champs modifiés ──────
    if sender:
        apply_sender_overrides(page, sender)

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
    if len(sys.argv) < 3:
        print("Usage: python3 process_bordereau.py <new_tracking> <output_path> [sender_json]",
              file=sys.stderr)
        sys.exit(1)
    sender = None
    if len(sys.argv) >= 4 and sys.argv[3].strip():
        try:
            sender = json.loads(sys.argv[3])
        except json.JSONDecodeError as e:
            print(f"sender JSON invalide : {e}", file=sys.stderr)
            sys.exit(1)
    process(sys.argv[1].strip(), sys.argv[2].strip(), sender)
