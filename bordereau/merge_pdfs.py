#!/usr/bin/env python3
"""Fusionne plusieurs PDFs en un seul fichier."""
import sys, json, os

files = json.loads(sys.argv[1])
out   = sys.argv[2]

try:
    from pypdf import PdfWriter
except ImportError:
    try:
        from PyPDF2 import PdfWriter
    except ImportError:
        print(json.dumps({"error": "pypdf non disponible"}))
        sys.exit(1)

writer = PdfWriter()
for f in files:
    if os.path.exists(f):
        writer.append(f)

if len(writer.pages) == 0:
    print(json.dumps({"error": "Aucune page à fusionner"}))
    sys.exit(1)

with open(out, "wb") as fh:
    writer.write(fh)

print(json.dumps({"ok": True}))
