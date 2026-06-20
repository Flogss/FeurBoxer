#!/usr/bin/env python3
"""Fusionne plusieurs PDFs — taille d'origine préservée, CropBox corrigé."""
import sys, json, os

files = json.loads(sys.argv[1])
out   = sys.argv[2]

try:
    from pypdf import PdfWriter, PdfReader, Transformation
    HAS_TRANSFORM = True
except ImportError:
    try:
        from PyPDF2 import PdfWriter, PdfReader
        Transformation = None
        HAS_TRANSFORM = False
    except ImportError:
        print(json.dumps({"error": "pypdf non disponible"}))
        sys.exit(1)

writer = PdfWriter()

for f in files:
    if not os.path.exists(f):
        continue
    try:
        reader = PdfReader(f)
        for orig in reader.pages:
            # CropBox = zone réellement visible ; MediaBox = page complète
            # On utilise CropBox s'il existe pour éviter les coupures
            if '/CropBox' in orig:
                box = orig.cropbox
            else:
                box = orig.mediabox

            w  = float(box.width)
            h  = float(box.height)
            x0 = float(box.left)
            y0 = float(box.bottom)

            # Page vierge aux dimensions exactes du document source
            new_page = writer.add_blank_page(w, h)

            # Si le CropBox est décalé par rapport à l'origine, on translate
            if HAS_TRANSFORM and (abs(x0) > 0.5 or abs(y0) > 0.5):
                t = Transformation().translate(-x0, -y0)
                new_page.merge_transformed_page(orig, t)
            else:
                new_page.merge_page(orig)

    except Exception as e:
        sys.stderr.write(json.dumps({"warn": f"Erreur {f}: {str(e)}"})+"\n")
        continue

if len(writer.pages) == 0:
    print(json.dumps({"error": "Aucune page à fusionner"}))
    sys.exit(1)

with open(out, "wb") as fh:
    writer.write(fh)

print(json.dumps({"ok": True, "pages": len(writer.pages)}))
