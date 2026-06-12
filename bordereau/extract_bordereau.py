#!/usr/bin/env python3
"""extract_bordereau.py — Analyse un PDF de bordereau de suivi et renvoie ses
infos structurées en JSON (sur stdout).

Approche volontairement générique / indépendante de la mise en page :
  1. Décodage de TOUS les codes-barres (1D + 2D) des pages rendues (zxing-cpp).
     Les étiquettes Chronopost/GeoPost embarquent un code Aztec contenant
     l'intégralité des données → fiable même sur un PDF "photo" sans texte.
  2. Extraction du texte (PyMuPDF) comme source complémentaire.
  3. Détection du transporteur + extraction par regex (suivi, email, tél,
     poids, date, code postal) sur l'ensemble texte + codes-barres.

Usage: python3 extract_bordereau.py <input.pdf>
"""

import sys, io, json, re
import fitz

# Séparateurs des codes 2D type MH10/ANSI (GeoPost/Chronopost)
GS, RS, US, EOT = "\x1d", "\x1e", "\x1f", "\x04"

# zxing-cpp renvoie les caractères de contrôle (0x00–0x20) sous forme de
# symboles Unicode "Control Pictures" (U+2400+c) — y compris l'espace (U+2420).
# On reconvertit en caractères réels avant tout parsing.
def _norm(s):
    return "".join(chr(ord(c) - 0x2400) if 0x2400 <= ord(c) <= 0x2420 else c for c in s)

# ── Regex génériques ──────────────────────────────────────────────────────
RE_S10    = re.compile(r"\b([A-Z]{2}\d{9}[A-Z]{2})\b")          # ex: XN107951405JB
RE_UPS    = re.compile(r"\b(1Z[0-9A-Z]{16})\b")                 # suivi UPS
RE_EMAIL  = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
RE_PHONE  = re.compile(r"(?:\+\d{1,3}[\s.]?|0)\d(?:[\s.]?\d){8}")
RE_WEIGHT = re.compile(r"(\d{1,3}[.,]\d{1,3})\s?[Kk][Gg]")
RE_DATE   = re.compile(r"\b(\d{2}/\d{2}/\d{4})\b")
RE_CP     = re.compile(r"\b(\d{5})\b")

CARRIERS = [
    ("Chronopost",    [r"chronopost", r"geop", r"fr-chr"]),
    ("Colissimo",     [r"colissimo", r"la poste", r"fr-col"]),
    ("UPS",           [r"\bups\b", r"1z[0-9a-z]{16}"]),
    ("DPD",           [r"\bdpd\b"]),
    ("Mondial Relay", [r"mondial\s?relay"]),
    ("Relais Colis",  [r"relais\s?colis"]),
    ("DHL",           [r"\bdhl\b"]),
    ("GLS",           [r"\bgls\b"]),
    ("FedEx",         [r"fedex"]),
    ("Bpost",         [r"bpost"]),
]


def render_decode(doc):
    """Décode tous les codes-barres de toutes les pages."""
    out = []
    try:
        import zxingcpp
        from PIL import Image
    except Exception:
        return out
    for page in doc:
        for zoom in (3, 4):
            pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
            img = Image.open(io.BytesIO(pix.tobytes("png")))
            try:
                results = zxingcpp.read_barcodes(img)
            except Exception:
                results = []
            for r in results:
                data = _norm(r.text)                      # vrais caractères de contrôle
                disp = re.sub(r"[\x00-\x1f]+", " · ", data).strip()  # lisible pour l'UI
                out.append({"format": str(r.format), "text": disp, "data": data})
            if out:  # un zoom a suffi
                break
    seen, uniq = set(), []
    for b in out:
        k = (b["format"], b["data"])
        if k not in seen:
            seen.add(k)
            uniq.append(b)
    return uniq


def _clean(s):
    return re.sub(r"\s+", " ", (s or "").strip()) or None


def parse_geopost(payload):
    """Parse le code Aztec GeoPost/Chronopost (séparateurs MH10)."""
    if "[)>" not in payload:
        return {}
    info = {"recipient": {}, "sender": {}}
    records = payload.replace(EOT, "").split(RS)
    for rec in records:
        f = rec.split(GS)
        if not f:
            continue
        # Enregistrement principal : contient le marqueur "GEOP"
        if "GEOP" in f:
            g = f.index("GEOP")
            # cp dest / 901 / dest_code / tracking13 / GEOP ...
            if g >= 4:
                cp = re.sub(r"\D", "", f[2])[-5:]
                if cp:
                    info["recipient"]["postal_code"] = cp
                info["tracking_internal"] = f[g - 1]
            # ... weight / packages / N / adresse / ville / / nom
            tail = f[g + 1:]
            for i, v in enumerate(tail):
                if re.fullmatch(r"\d/\d", v):
                    info["packages"] = v
                    after = tail[i + 1:]
                    # poids = 1er token avec KG
                    for j, w in enumerate(after):
                        if re.search(r"[Kk][Gg]", w):
                            info["weight"] = _clean(w)
                            rest = [x for x in after[j + 1:] if x and x != "N"]
                            if len(rest) >= 1:
                                info["recipient"]["address"] = _clean(rest[0])
                            if len(rest) >= 2:
                                info["recipient"]["city"] = _clean(rest[1])
                            if rest:
                                info["recipient"]["name"] = _clean(rest[-1])
                            break
                    break
        # Bloc expéditeur : 2e champ commence par "S0"
        elif len(f) >= 3 and f[1].startswith("S0"):
            u = f[2].split(US)
            info["sender"] = _parse_party(u)
        # Bloc contact destinataire : champ "G03"
        elif "G03" in f:
            joined = US.join(f)
            u = joined.split(US)
            em = RE_EMAIL.search(joined)
            if em:
                info["recipient"]["email"] = em.group(0)
            ph = RE_PHONE.search(joined)
            if ph and "phone" not in info["recipient"]:
                info["recipient"]["phone"] = _clean(ph.group(0))
            for v in u:
                v = _clean(v)
                if v and not RE_EMAIL.search(v) and not RE_PHONE.fullmatch(v) \
                   and not re.fullmatch(r"[\d]+", v) and v not in ("G03",) \
                   and "name" not in info["recipient"]:
                    info["recipient"]["name"] = v
                    break
        # Bloc date/suivi : "D001011"
        elif len(f) >= 4 and f[1].startswith("D00"):
            d = f[2]
            if re.fullmatch(r"\d{6}", d):
                info["date"] = f"{d[0:2]}/{d[2:4]}/20{d[4:6]}"
            m = RE_S10.search(GS.join(f))
            if m:
                info["tracking"] = m.group(1)
    return info


def _parse_party(us_fields):
    """Extrait nom/tél/rue/ville/cp depuis les sous-champs US d'un bloc.

    Structure GeoPost typique : nom, tél, (nom répété), '', rue, '', ville, cp, code.
    """
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
            continue  # codes numériques internes (250, …)
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


def detect_carrier(blob):
    low = blob.lower()
    for name, pats in CARRIERS:
        for p in pats:
            if re.search(p, low):
                return name
    return None


def first(rx, blob, group=1):
    m = rx.search(blob)
    return m.group(group) if m else None


def extract(pdf_path):
    doc = fitz.open(pdf_path)
    text = "\n".join(p.get_text("text") for p in doc)
    barcodes = render_decode(doc)
    bc_blob = "\n".join(b["data"] for b in barcodes)
    blob = text + "\n" + bc_blob

    result = {
        "carrier": detect_carrier(blob),
        "tracking": None,
        "weight": None,
        "date": None,
        "packages": None,
        "recipient": {},
        "sender": {},
        "references": [],
        "emails": [],
        "phones": [],
        "barcodes": barcodes,
        "pages": doc.page_count,
        "has_text": bool(text.strip()),
    }

    # Parse du code 2D GeoPost (le plus complet)
    for b in barcodes:
        if "[)>" in b["data"]:
            gp = parse_geopost(b["data"])
            for k in ("tracking", "weight", "date", "packages"):
                if gp.get(k):
                    result[k] = gp[k]
            if gp.get("recipient"):
                result["recipient"].update({k: v for k, v in gp["recipient"].items() if v})
            if gp.get("sender"):
                result["sender"].update({k: v for k, v in gp["sender"].items() if v})
            break

    # Suivi : code-barres 1D propre > regex globale
    if not result["tracking"]:
        for b in barcodes:
            m = RE_S10.search(b["data"]) or RE_UPS.search(b["data"])
            if m:
                result["tracking"] = m.group(1)
                break
    if not result["tracking"]:
        result["tracking"] = first(RE_S10, blob) or first(RE_UPS, blob)

    # Compléments par regex (si non fournis par le 2D)
    if not result["weight"]:
        w = first(RE_WEIGHT, blob)
        if w:
            result["weight"] = w.replace(",", ".") + " KG"
    if not result["date"]:
        result["date"] = first(RE_DATE, text)

    result["emails"] = sorted(set(RE_EMAIL.findall(blob)))

    # Téléphones : ceux du 2D + ceux portant un libellé (évite les fragments de code-barres)
    phones = set()
    for party in ("sender", "recipient"):
        if result[party].get("phone"):
            phones.add(result[party]["phone"])
    for m in re.finditer(r"(?:Phone|T[ée]l\.?)\s*:?\.?\s*([+0][\d\s().\-]{8,})", text, re.I):
        digits = re.sub(r"[^\d+]", "", m.group(1))
        if re.fullmatch(r"(?:\+\d{1,3})?0?[1-9]\d{8}", digits):
            phones.add(_clean(m.group(1)))
    # Dédoublonnage : même numéro (9 derniers chiffres), on garde la version la plus propre
    by_key = {}
    for ph in phones:
        key = re.sub(r"\D", "", ph)[-9:]
        if key not in by_key or ph.count(" ") < by_key[key].count(" "):
            by_key[key] = ph
    result["phones"] = sorted(by_key.values())

    # Poids : format homogène "X.XX kg"
    if result["weight"]:
        mw = re.search(r"(\d+[.,]\d+)", result["weight"])
        if mw:
            result["weight"] = mw.group(1).replace(",", ".") + " kg"

    refs = re.findall(r"(?:Référence|Reference|Ref)\s*(?:de l'envoi)?\s*:\s*([^\n]+)", text)
    result["references"] = sorted({_clean(r) for r in refs if _clean(r) and len(_clean(r)) < 60})

    # Fallback texte (étiquettes sans code 2D, ex. certains Chronopost internationaux)
    if not result["recipient"].get("name"):
        _recipient_from_top(text, result)
    if not result["sender"].get("name"):
        _sender_from_text(text, result)

    result["raw_text"] = text[:4000]
    return result


COUNTRY_LINE = re.compile(r"^[A-Z]{2}\s+[A-ZÀ-Ÿ]")          # "ES ESPAGNE", "FR FRANCE"
DIGIT_RUN    = re.compile(r"^[\d ]{9,}$")                    # ligne de chiffres (code-barres)


def _fill_party(block, party):
    """Renseigne nom/adresse/cp/ville à partir d'un bloc de lignes."""
    if not block:
        return
    party.setdefault("name", block[0])
    rest = block[1:]
    pcs = [l for l in rest if re.fullmatch(r"\d{4,5}", l)]
    cities = [l for l in rest if re.fullmatch(r"[A-Za-zÀ-ÿ'’\- ]+", l)]
    addr = [l for l in rest if l not in pcs and l not in cities]
    # "25000 Besançon" sur une seule ligne
    for l in rest:
        m = re.match(r"(\d{4,5})\s+([A-Za-zÀ-ÿ'’\- ]+)$", l)
        if m:
            party.setdefault("postal_code", m.group(1))
            party.setdefault("city", _clean(m.group(2)))
            addr = [a for a in addr if a != l]
    if pcs:
        party.setdefault("postal_code", pcs[0])
    if cities:
        party.setdefault("city", cities[-1])
    if addr:
        party.setdefault("address", addr[0])


def _recipient_from_top(text, result):
    """Destinataire = bloc juste après le n° de suivi (haut de l'étiquette)."""
    lines = [l.strip() for l in text.splitlines()]
    trk = result.get("tracking")
    idx = next((i for i, l in enumerate(lines) if trk and trk in l), None)
    if idx is None:
        return
    block = []
    for l in lines[idx + 1:idx + 7]:
        if not l:
            continue
        if COUNTRY_LINE.match(l) or DIGIT_RUN.match(l):
            break
        block.append(l)
    _fill_party(block, result["recipient"])


def _sender_from_text(text, result):
    """Expéditeur = bloc après l'en-tête 'Sender' / 'Expéditeur'."""
    lines = [l.strip() for l in text.splitlines()]
    si = next((i for i, l in enumerate(lines)
               if l.lower() in ("sender", "expéditeur", "expediteur")), None)
    if si is None:
        return
    block = []
    for l in lines[si + 1:si + 7]:
        if not l or l.lower().startswith(("phone", "tél", "tel", "reference", "référence")):
            if block:
                break
            continue
        block.append(l)
    _fill_party(block, result["sender"])


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(json.dumps({"error": "Usage: extract_bordereau.py <input.pdf>"}))
        sys.exit(1)
    try:
        print(json.dumps(extract(sys.argv[1]), ensure_ascii=False, indent=2))
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        sys.exit(1)
