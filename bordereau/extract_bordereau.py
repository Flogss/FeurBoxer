#!/usr/bin/env python3
"""extract_bordereau.py — Analyse un PDF de bordereau de suivi → JSON (stdout).

Deux sources d'information renvoyées séparément :
  • "text"  : infos lues directement dans le PDF (affichage par défaut)
  • "aztec" : infos lues dans le code-barres 2D Aztec (GeoPost/Chronopost),
              utile en secours et sur les PDF scannés sans texte.

Traitement page par page : on ne lit qu'UNE étiquette (la 1re page porteuse
d'un code-barres ou d'un n° de suivi) pour ne pas mélanger plusieurs colis.

Usage: python3 extract_bordereau.py <input.pdf>
"""

import sys, io, json, re
import fitz

GS, RS, US, EOT = "\x1d", "\x1e", "\x1f", "\x04"


def _norm(s):
    # zxing renvoie les caractères de contrôle (0x00–0x20) en symboles U+2400+
    return "".join(chr(ord(c) - 0x2400) if 0x2400 <= ord(c) <= 0x2420 else c for c in s)


# ── Regex ─────────────────────────────────────────────────────────────────
RE_S10    = re.compile(r"\b([A-Z]{2}\d{9}[A-Z]{2})\b")
RE_UPS    = re.compile(r"\b(1Z[0-9A-Z]{16})\b")
RE_EMAIL  = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
RE_WEIGHT = re.compile(r"(\d{1,3}[.,]\d{1,3})\s?[Kk][Gg]")
RE_DATE   = re.compile(r"\b(\d{2}/\d{2}/\d{4})\b")
RE_DATE2  = re.compile(r"\b(\d{2}/\d{2}/\d{2})\b")
RE_PHONE  = re.compile(r"(?:\+\d{1,3}[\s.]?|0)\d(?:[\s.]?\d){8}")

COUNTRY = re.compile(r"^[A-Z]{2}\s*-\s*[A-ZÀ-Ÿ].+$|^[A-Z]{2}\s+[A-ZÀ-Ÿ]{3,}.*$")
LABEL_NOISE = re.compile(
    r"^(Exp[ée]diteur|Sender|Destinataire|Recipient|Delivery address|T[ée]l[ée]phone|"
    r"T[ée]l|Tel|Phone|R[ée]f|Ref|Reference|R[ée]f[ée]rence|Poids|Weight|Date|N[°o]|"
    r"Colis|Track|Service|Contact|Packages|Adresse|Compte|CP71|Collez|Etiquette|Comment|"
    r"Preuve|Option|Customs|City|Business|Personal|Do not|Please|Remarque|Le colis)\b", re.I)
SENDER_MK = {"sender", "expéditeur", "expediteur"}
RECIP_MK  = {"recipient", "destinataire"}

CARRIERS = [
    ("Colissimo",     [r"colissimo", r"la poste", r"fr-col"]),
    ("Chronopost",    [r"chronopost", r"fr-chr", r"geop"]),
    ("UPS",           [r"\bups\b", r"1z[0-9a-z]{16}"]),
    ("DPD",           [r"\bdpd\b"]),
    ("Mondial Relay", [r"mondial\s?relay"]),
    ("Relais Colis",  [r"relais\s?colis"]),
    ("DHL",           [r"\bdhl\b"]),
    ("GLS",           [r"\bgls\b"]),
    ("FedEx",         [r"fedex"]),
    ("Bpost",         [r"bpost"]),
]


def _clean(s):
    return re.sub(r"\s+", " ", (s or "").strip()) or None


def detect_carrier(blob):
    low = (blob or "").lower()
    for name, pats in CARRIERS:
        if any(re.search(p, low) for p in pats):
            return name
    return None


def _dedup_phones(phones):
    by_key = {}
    for ph in phones:
        key = re.sub(r"\D", "", ph)[-9:]
        if key and (key not in by_key or ph.count(" ") < by_key[key].count(" ")):
            by_key[key] = ph
    return sorted(by_key.values())


def _spaced_s10(text):
    m = re.search(r"\b([A-Z]{2})[ ]([\d][\d ]{7,13}\d)[ ]?([A-Z]{2})\b", text)
    if m:
        d = re.sub(r"\D", "", m.group(2))
        if len(d) == 9:
            return m.group(1) + d + m.group(3)
    return None


# ── Décodage des codes-barres (par page) ───────────────────────────────────
def decode_page(page):
    out = []
    try:
        import zxingcpp
        from PIL import Image
    except Exception:
        return out
    for zoom in (3, 4):
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
        img = Image.open(io.BytesIO(pix.tobytes("png")))
        try:
            results = zxingcpp.read_barcodes(img)
        except Exception:
            results = []
        for r in results:
            data = _norm(r.text)
            disp = re.sub(r"[\x00-\x1f]+", " · ", data).strip()
            out.append({"format": str(r.format), "text": disp, "data": data})
        if out:
            break
    seen, uniq = set(), []
    for b in out:
        if (b["format"], b["data"]) not in seen:
            seen.add((b["format"], b["data"]))
            uniq.append(b)
    return uniq


def find_label_page(doc):
    """1re page portant un code-barres ou un n° de suivi (sinon page 1)."""
    for i, page in enumerate(doc):
        t = page.get_text("text")
        bcs = decode_page(page)
        if bcs or RE_S10.search(t) or _spaced_s10(t):
            return i, t, bcs
    return 0, doc[0].get_text("text"), decode_page(doc[0])


# ── Parse du code Aztec GeoPost ────────────────────────────────────────────
def parse_geopost(payload):
    if "[)>" not in payload:
        return {}
    info = {"recipient": {}, "sender": {}}
    for rec in payload.replace(EOT, "").split(RS):
        f = rec.split(GS)
        if not f:
            continue
        if "GEOP" in f:
            g = f.index("GEOP")
            if g >= 4:
                cp = re.sub(r"\D", "", f[2])[-5:]
                if cp:
                    info["recipient"]["postal_code"] = cp
            tail = f[g + 1:]
            for i, v in enumerate(tail):
                if re.fullmatch(r"\d+/\d+", v):
                    info["packages"] = v
                    for j, w in enumerate(tail[i + 1:]):
                        if re.search(r"[Kk][Gg]", w):
                            info["weight"] = _clean(w)
                            rest = [x for x in tail[i + 1:][j + 1:] if x and x != "N"]
                            if rest:
                                info["recipient"].setdefault("name", _clean(rest[-1]))
                            break
                    break
        elif len(f) >= 3 and f[1].startswith("S0"):
            info["sender"] = _parse_party_us(f[2].split(US))
        elif "G03" in f:
            joined = US.join(f)
            em = RE_EMAIL.search(joined)
            if em:
                info["recipient"]["email"] = em.group(0)
            ph = RE_PHONE.search(joined)
            if ph:
                info["recipient"].setdefault("phone", _clean(ph.group(0)))
        elif len(f) >= 4 and f[1].startswith("D00"):
            if re.fullmatch(r"\d{6}", f[2]):
                info["date"] = f"{f[2][0:2]}/{f[2][2:4]}/20{f[2][4:6]}"
            m = RE_S10.search(GS.join(f))
            if m:
                info["tracking"] = m.group(1)
    return info


def _parse_party_us(us_fields):
    p, alpha = {}, []
    for v in (x.strip() for x in us_fields):
        if not v:
            continue
        if RE_EMAIL.search(v):
            p.setdefault("email", RE_EMAIL.search(v).group(0))
        elif RE_PHONE.fullmatch(v):
            p.setdefault("phone", v)
        elif re.fullmatch(r"\d{4,5}", v):
            p.setdefault("postal_code", v)
        elif re.fullmatch(r"\d+", v):
            continue
        elif re.match(r"\d+\b", v) and re.search(r"[A-Za-zÀ-ÿ]", v):
            p.setdefault("address", _clean(v))
        elif re.fullmatch(r"[A-Za-zÀ-ÿ'’\- ]+", v):
            alpha.append(_clean(v))
    if alpha:
        p["name"] = alpha[0]
        cities = [a for a in alpha[1:] if a != p["name"]]
        if cities:
            p["city"] = cities[-1]
    return p


def parse_barcodes(barcodes):
    info = {"recipient": {}, "sender": {}, "references": [], "emails": [], "phones": []}
    for b in barcodes:
        if "[)>" in b["data"]:
            gp = parse_geopost(b["data"])
            for k in ("tracking", "weight", "date", "packages"):
                if gp.get(k):
                    info[k] = gp[k]
            info["recipient"].update({k: v for k, v in gp.get("recipient", {}).items() if v})
            info["sender"].update({k: v for k, v in gp.get("sender", {}).items() if v})
    if not info.get("tracking"):
        for b in barcodes:
            m = RE_S10.search(b["data"]) or RE_UPS.search(b["data"])
            if m:
                info["tracking"] = m.group(1)
                break
    # Repli : contenu d'un code-barres lisible (ni Aztec structuré, ni code de routage)
    if not info.get("tracking"):
        for b in barcodes:
            t = b["data"].strip()
            if "[)>" in t or t.startswith("%"):
                continue
            if re.fullmatch(r"[A-Za-z0-9\-]{8,40}", t):
                info["tracking"] = t
                break
    blob = "\n".join(b["data"] for b in barcodes)
    info["emails"] = sorted(set(RE_EMAIL.findall(blob)))
    info["phones"] = _dedup_phones({p for p in (info["sender"].get("phone"),
                                                info["recipient"].get("phone")) if p})
    if info.get("weight"):
        mw = re.search(r"(\d+[.,]\d+)", info["weight"])
        if mw:
            info["weight"] = mw.group(1).replace(",", ".") + " kg"
    return info


# ── Parse du texte du PDF ──────────────────────────────────────────────────
STREET = re.compile(r"\b(rue|avenue|av|bd|boulevard|chemin|impasse|all[ée]e|route|quai|place|cours|chauss[ée]e|voie|lot|zone|za[ce]?)\b", re.I)


def _is_noise(l):
    if not l or LABEL_NOISE.match(l) or COUNTRY.match(l) or len(l) > 45:
        return True
    if re.fullmatch(r"\d+\s*/\s*\d+", l):               # "1 / 1" (colis)
        return True
    digits = len(re.sub(r"\D", "", l))
    if re.fullmatch(r"[\d /.\-]+", l) and digits > 6:   # longue suite de chiffres
        return True
    if digits >= 8 and digits / len(l) > 0.5:           # ligne de code-barres
        return True
    return False


def _looks_street(l):
    return bool(re.match(r"^\d+\b.*[A-Za-zÀ-ÿ]", l)) or bool(STREET.search(l))


def _valid_block(blk):
    """Un bloc d'adresse crédible contient un code postal ou une voie."""
    return any(re.search(r"\b\d{4,5}\b", l) or _looks_street(l) for l in blk)


def _street_clusters(lines):
    """Repli : regroupe nom/rue/CP/ville autour d'une ligne de voie."""
    out = []
    for i, l in enumerate(lines):
        if _is_noise(l) or not _looks_street(l):
            continue
        # nom : ligne proche (au-dessus ou en-dessous) avec ≥2 mots alpha
        name = None
        for j in (i - 1, i + 1, i - 2, i + 2):
            if 0 <= j < len(lines):
                c = lines[j].strip()
                if c and not _is_noise(c) and not _looks_street(c) \
                   and not re.search(r"\d{4,5}", c) and re.match(r"[A-Za-zÀ-ÿ]+ [A-Za-zÀ-ÿ]", c):
                    name = c
                    break
        cp = city = None
        for j in range(i, min(i + 4, len(lines))):
            mm = re.search(r"\b(\d{4,5})\b", lines[j])
            if mm and not _looks_street(lines[j]):
                cp = mm.group(1)
                rest = re.sub(r"\b\d{4,5}\b", "", lines[j]).strip(" -,")
                if len(rest) >= 3 and not re.fullmatch(r"[A-Z]{2}", rest) and re.search(r"[A-Za-zÀ-ÿ]", rest):
                    city = rest
                if not city:
                    for k in range(j + 1, min(j + 3, len(lines))):
                        cand = lines[k].strip()
                        if re.fullmatch(r"[A-Za-zÀ-ÿ'’\- ]{3,}", cand):
                            city = cand
                            break
                break
        out.append({k: v for k, v in {"name": _clean(name), "address": _clean(l),
                                       "postal_code": cp, "city": _clean(city)}.items() if v})
    return out


def _block_above(lines, i):
    blk, j = [], i - 1
    while j >= 0 and len(blk) < 4:
        l = lines[j]
        if _is_noise(l):
            if blk:
                break
            j -= 1
            continue
        blk.insert(0, l)
        j -= 1
    return blk


def _block_after(lines, markers):
    for i, l in enumerate(lines):
        if l.lower() in markers:
            blk, j = [], i + 1
            while j < len(lines) and len(blk) < 4:
                lj = lines[j]
                if _is_noise(lj):
                    if blk:
                        break
                    j += 1
                    continue
                blk.append(lj)
                j += 1
            if blk:
                return blk
    return None


def _fill_party(block, party):
    # Ignore les lignes purement numériques en tête (réf client, etc.)
    while block and re.fullmatch(r"[\d ]+", block[0]):
        block = block[1:]
    if not block:
        return
    party.setdefault("name", _clean(block[0]))
    rest, cp_line = block[1:], None
    for l in rest:
        m = re.search(r"\b(\d{4,5})\b", l)
        if m:
            party.setdefault("postal_code", m.group(1))
            city = re.sub(r"\b\d{4,5}\b", "", l).strip(" ,-")
            if re.search(r"[A-Za-zÀ-ÿ]", city):
                party.setdefault("city", _clean(city))
            cp_line = l
            break
    for l in rest:
        if l is cp_line:
            continue
        if re.search(r"[A-Za-zÀ-ÿ]", l) and "address" not in party:
            party["address"] = _clean(l)
            break
    if "city" not in party:
        for l in rest:
            if l is not cp_line and re.fullmatch(r"[A-Za-zÀ-ÿ'’\- ]+", l) \
               and _clean(l) not in (party.get("name"), party.get("address")):
                party["city"] = _clean(l)
                break


def parse_text(text):
    info = {"recipient": {}, "sender": {}, "references": [], "emails": [], "phones": []}
    strp = [l.strip() for l in text.splitlines()]

    m = RE_S10.search(text)
    info["tracking"] = m.group(1) if m else _spaced_s10(text)
    w = RE_WEIGHT.search(text)
    if w:
        info["weight"] = w.group(1).replace(",", ".") + " kg"
    d = RE_DATE.search(text) or RE_DATE2.search(text)
    if d:
        info["date"] = d.group(1)
    info["emails"] = sorted(set(RE_EMAIL.findall(text)))

    phones = set()
    for mm in re.finditer(r"(?:Phone|T[ée]l[ée]?phone|T[ée]l)\s*:?\.?\s*([+0][\d\s().\-]{8,})", text, re.I):
        digits = re.sub(r"[^\d+]", "", mm.group(1))
        if re.fullmatch(r"(?:\+\d{1,3})?0?[1-9]\d{8}", digits):
            phones.add(_clean(mm.group(1)))
    info["phones"] = _dedup_phones(phones)

    refs = re.findall(r"(?:R[ée]f[ée]rence|Reference|Ref|R[ée]f)\s*(?:de l'envoi|desti|client\.?)?\s*[:.]\s*([^\n]+)", text)
    info["references"] = sorted({_clean(r) for r in refs
                                 if _clean(r) and re.search(r"\d", _clean(r)) and len(_clean(r)) < 60})

    country_blocks = [b for b in (_block_above(strp, i) for i, l in enumerate(strp) if COUNTRY.match(l)) if b and _valid_block(b)]
    sender_blk = _block_after(strp, SENDER_MK)
    recip_blk = _block_after(strp, RECIP_MK)
    if sender_blk and not _valid_block(sender_blk):
        sender_blk = None
    if recip_blk and not _valid_block(recip_blk):
        recip_blk = None
    if not sender_blk and country_blocks:
        sender_blk = country_blocks[0]
        if not recip_blk and len(country_blocks) > 1:
            recip_blk = country_blocks[1]
    if not recip_blk and country_blocks:
        recip_blk = next((b for b in country_blocks if b != sender_blk), country_blocks[0])
    if sender_blk:
        _fill_party(sender_blk, info["sender"])
    if recip_blk:
        _fill_party(recip_blk, info["recipient"])

    # Repli : clusters de voie pour les destinataire/expéditeur encore vides
    if not info["recipient"].get("name") or not info["sender"].get("name"):
        clusters = _street_clusters(strp)
        used = set()
        for party in ("recipient", "sender"):
            if info[party].get("name"):
                continue
            for ci, c in enumerate(clusters):
                if ci in used or not c.get("name"):
                    continue
                info[party] = c
                used.add(ci)
                break
    return info


# ── Orchestration ──────────────────────────────────────────────────────────
def extract(pdf_path):
    doc = fitz.open(pdf_path)
    idx, text, barcodes = find_label_page(doc)
    bc_blob = "\n".join(b["data"] for b in barcodes)

    text_info = parse_text(text)
    aztec_info = parse_barcodes(barcodes)
    has_aztec = any("[)>" in b["data"] for b in barcodes)
    has_text = bool(text.strip())

    carrier = detect_carrier(text) or detect_carrier(bc_blob)
    tracking = text_info.get("tracking") or aztec_info.get("tracking")

    return {
        "carrier": carrier,
        "tracking": tracking,
        "pages": doc.page_count,
        "page_used": idx + 1,
        "multi_page": doc.page_count > 1,
        "has_text": has_text,
        "has_aztec": has_aztec,
        "text": text_info,
        "aztec": aztec_info if (has_aztec or aztec_info.get("tracking")) else None,
        "barcodes": [{"format": b["format"], "text": b["text"]} for b in barcodes],
        "raw_text": text[:4000],
    }


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(json.dumps({"error": "Usage: extract_bordereau.py <input.pdf>"}))
        sys.exit(1)
    try:
        print(json.dumps(extract(sys.argv[1]), ensure_ascii=False, indent=2))
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        sys.exit(1)
