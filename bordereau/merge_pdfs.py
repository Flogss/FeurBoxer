#!/usr/bin/env python3
"""Fusionne plusieurs PDFs en un seul — préserve la taille d'origine de chaque page."""
import sys, json, os

files = json.loads(sys.argv[1])
out   = sys.argv[2]

try:
    from pypdf import PdfWriter, PdfReader
except ImportError:
    try:
        from PyPDF2 import PdfWriter, PdfReader
    except ImportError:
        print(json.dumps({"error": "pypdf non disponible"}))
        sys.exit(1)

writer = PdfWriter()
for f in files:
    if not os.path.exists(f):
        continue
    reader = PdfReader(f)
    for page in reader.pages:
        writer.add_page(page)  # copie la page sans transformation ni redimensionnement

if len(writer.pages) == 0:
    print(json.dumps({"error": "Aucune page à fusionner"}))
    sys.exit(1)

with open(out, "wb") as fh:
    writer.write(fh)

print(json.dumps({"ok": True}))
