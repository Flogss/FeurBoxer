#!/usr/bin/env python3
"""modify_bordereau.py — Modifie un bordereau uploadé puis le réenregistre.

Applique des remplacements de texte (ex. nom d'expéditeur) et/ou remplace des
codes-barres par un nouveau code (généré au même emplacement, même format).

Usage: python3 modify_bordereau.py <input.pdf> <output.pdf> <edits.json>
  edits = {
    "page": 0,
    "text": [{"old": "...", "new": "..."}, ...],
    "barcodes": [{"old": "<texte décodé>", "new": "<nouveau code>", "format": "Code128"}, ...]
  }
"""

import sys, io, json, re
import fitz

ZOOM = 3
_HEBO = fitz.Font("hebo")
_HELV = fitz.Font("helv")


def _norm(s):
    return "".join(chr(ord(c) - 0x2400) if 0x2400 <= ord(c) <= 0x2420 else c for c in s)


def find_spans(page, target):
    """Tous les spans dont le texte == target."""
    out = []
    for b in page.get_text("rawdict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]:
        for line in b.get("lines", []):
            for span in line.get("spans", []):
                t = "".join(c.get("c", "") for c in span.get("chars", [])).strip()
                if t == target:
                    out.append(span)
    return out


def replace_text(page, old, new):
    if not old or new is None or old == new:
        return 0
    n = 0
    for span in find_spans(page, old):
        ox, oy = span["origin"]
        size = span["size"]
        bbox = span["bbox"]
        bold = bool(span["flags"] & 16)
        font = _HEBO if bold else _HELV
        fname = "hebo" if bold else "helv"
        new_w = font.text_length(new, size)
        right = max(bbox[2], ox + new_w) + 1
        wr = fitz.Rect(bbox[0] - 1, oy - 0.78 * size, right, oy + 0.28 * size)
        page.draw_rect(wr, fill=(1, 1, 1), color=None, overlay=True)
        page.insert_text(fitz.Point(ox, oy), new, fontname=fname, fontsize=size, color=(0, 0, 0))
        n += 1
    return n


def _gen_barcode_png(text, fmt_name):
    import zxingcpp
    fmt_name = (fmt_name or "Code128").replace(" ", "")   # "Code 128" → "Code128"
    fmt = getattr(zxingcpp.BarcodeFormat, fmt_name, zxingcpp.BarcodeFormat.Code128)
    try:
        bc = zxingcpp.create_barcode(text, fmt)
        img = zxingcpp.write_barcode_to_image(bc)
    except Exception:
        img = zxingcpp.write_barcode(fmt, text)
    from PIL import Image
    if not isinstance(img, Image.Image):
        img = Image.fromarray(img)
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    return buf.getvalue(), (img.width, img.height)


def replace_barcodes(page, edits):
    import zxingcpp
    from PIL import Image
    pix = page.get_pixmap(matrix=fitz.Matrix(ZOOM, ZOOM))
    img = Image.open(io.BytesIO(pix.tobytes("png")))
    decoded = []
    for r in zxingcpp.read_barcodes(img):
        p = r.position
        xs = [p.top_left.x, p.top_right.x, p.bottom_right.x, p.bottom_left.x]
        ys = [p.top_left.y, p.top_right.y, p.bottom_right.y, p.bottom_left.y]
        decoded.append({
            "format": str(r.format),
            "text": _norm(r.text),
            "rect": fitz.Rect(min(xs) / ZOOM, min(ys) / ZOOM, max(xs) / ZOOM, max(ys) / ZOOM),
        })

    count = 0
    for e in edits:
        old = _norm(e.get("old", ""))
        new = e.get("new", "")
        if not new:
            continue
        # Retrouver le code décodé correspondant (par texte, sinon par format)
        match = next((d for d in decoded if d["text"] == old), None)
        if not match:
            match = next((d for d in decoded if d["format"].lower() == str(e.get("format", "")).lower()), None)
        if not match:
            continue
        rect = match["rect"]
        is2d = match["format"].lower() in ("qrcode", "aztec", "datamatrix", "pdf417")
        png, (w, h) = _gen_barcode_png(new, e.get("format") or match["format"])
        # Blanchir l'ancien code (marge légère)
        page.draw_rect(fitz.Rect(rect.x0 - 2, rect.y0 - 2, rect.x1 + 2, rect.y1 + 2),
                       fill=(1, 1, 1), color=None, overlay=True)
        if is2d:
            # garder le carré, centré dans la zone
            side = min(rect.width, rect.height)
            cx, cy = (rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2
            target = fitz.Rect(cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2)
        else:
            target = rect
            # remplace aussi le texte lisible sous le code 1D (ex. "XN107951405JB")
            if re.fullmatch(r"[A-Za-z0-9 \-]{4,40}", old):
                replace_text(page, old, new)
        page.insert_image(target, stream=png, keep_proportion=False)
        count += 1
    return count


def modify(input_pdf, output_pdf, edits):
    doc = fitz.open(input_pdf)
    page = doc[edits.get("page", 0) if edits.get("page", 0) < doc.page_count else 0]
    changed = 0
    for r in edits.get("text", []):
        changed += replace_text(page, (r.get("old") or "").strip(), (r.get("new") or "").strip())
    if edits.get("barcodes"):
        changed += replace_barcodes(page, edits["barcodes"])
    doc.save(output_pdf, deflate=True, garbage=3)
    doc.close()
    return changed


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print(json.dumps({"error": "Usage: modify_bordereau.py <in.pdf> <out.pdf> <edits.json>"}))
        sys.exit(1)
    try:
        edits = json.loads(sys.argv[3])
        n = modify(sys.argv[1], sys.argv[2], edits)
        print(json.dumps({"ok": True, "changed": n}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
