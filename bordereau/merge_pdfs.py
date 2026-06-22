#!/usr/bin/env python3
"""Fusionne des PDFs — chaque page est mise à l'échelle pour tenir sur A4, centrée, sans coupure."""
import sys, json, os

files = json.loads(sys.argv[1])
out   = sys.argv[2]
# codes: dict {filepath: code_string} optionnel
codes = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}

A4_W, A4_H = 595.28, 841.89
MARGIN = 14  # ~5mm de marge

# ── Méthode 1 : pymupdf (fitz) — rendu haute fidélité ──
try:
    import fitz

    dst = fitz.open()
    for fn in files:
        if not os.path.exists(fn):
            continue
        try:
            page_before = dst.page_count
            src = fitz.open(fn)
            for pno in range(src.page_count):
                page = src[pno]
                rect = page.rect  # respecte le CropBox automatiquement
                w, h = rect.width, rect.height
                if w <= 0 or h <= 0:
                    continue
                # Mise à l'échelle pour remplir A4 (sans dépasser)
                scale = min((A4_W - 2 * MARGIN) / w, (A4_H - 2 * MARGIN) / h)
                sw, sh = w * scale, h * scale
                x0 = (A4_W - sw) / 2
                y0 = (A4_H - sh) / 2
                new_page = dst.new_page(-1, width=A4_W, height=A4_H)
                new_page.show_pdf_page(fitz.Rect(x0, y0, x0 + sw, y0 + sh), src, pno)
            src.close()
            # Ajoute le code d'identification sur la dernière page ajoutée
            code = codes.get(fn, '')
            if code and dst.page_count > page_before:
                last = dst[dst.page_count - 1]
                r = last.rect
                tw = fitz.get_text_length(code, fontsize=9)
                px = r.width - tw - 8
                py = r.height - 8
                last.insert_text(fitz.Point(px, py), code, fontsize=9, color=(0.55, 0.55, 0.55))
        except Exception as e:
            sys.stderr.write(f"Erreur {fn}: {e}\n")

    count = dst.page_count
    if count == 0:
        print(json.dumps({"error": "Aucune page à fusionner"}))
        sys.exit(1)

    dst.save(out, garbage=4, deflate=True)
    dst.close()
    print(json.dumps({"ok": True, "pages": count}))
    sys.exit(0)

except ImportError:
    pass  # fallback pypdf

# ── Méthode 2 : pypdf avec Transformation CTM ──
try:
    from pypdf import PdfWriter, PdfReader, Transformation
    HAS_T = True
except ImportError:
    try:
        from PyPDF2 import PdfWriter, PdfReader
        Transformation = None
        HAS_T = False
    except ImportError:
        print(json.dumps({"error": "Aucune bibliothèque PDF disponible (pypdf/PyPDF2/pymupdf)"}))
        sys.exit(1)

writer = PdfWriter()
for fn in files:
    if not os.path.exists(fn):
        continue
    try:
        reader = PdfReader(fn)
        for orig in reader.pages:
            box = orig.cropbox if '/CropBox' in orig else orig.mediabox
            w  = float(box.width)
            h  = float(box.height)
            x0 = float(box.left)
            y0 = float(box.bottom)
            if w <= 0 or h <= 0:
                continue

            scale = min((A4_W - 2 * MARGIN) / w, (A4_H - 2 * MARGIN) / h)
            sw, sh = w * scale, h * scale
            cx = (A4_W - sw) / 2
            cy = (A4_H - sh) / 2

            new_page = writer.add_blank_page(A4_W, A4_H)
            if HAS_T:
                # CTM: translate CropBox offset + scale + center
                t = Transformation(matrix=(scale, 0, 0, scale,
                                           cx - x0 * scale,
                                           cy - y0 * scale))
                new_page.merge_transformed_page(orig, t)
            else:
                new_page.merge_page(orig)
    except Exception as e:
        sys.stderr.write(json.dumps({"warn": f"Erreur {fn}: {e}"}) + "\n")

if len(writer.pages) == 0:
    print(json.dumps({"error": "Aucune page à fusionner"}))
    sys.exit(1)

with open(out, "wb") as fh:
    writer.write(fh)
print(json.dumps({"ok": True, "pages": len(writer.pages)}))
