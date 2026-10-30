"""Build the syllabus-mapper outputs for JEE Main 2027 and NEET UG 2026 from the sources in ./sources.

Run from anywhere:  python3 -I tools/content-research/build.py
It reads only local files (no network) and rewrites:

  content/graph/{subject}/subject.json            subject@1
  content/graph/{subject}/{chapter_slug}.json     chapter@1
  content/exam-maps/{profile}.json                exam-map@1
  content/coverage/syllabus/{profile}.json        syllabus@1 (official lines, en + hi, with their concepts)
  content/coverage/inventory/{subject}/{chapter_slug}.json   inventory@1 (every NCERT section of the chapter)

Then run `pnpm content:check` (add `--write-coverage` through the package script to refresh content/coverage/*.json).

Sources (all checked in under ./sources):
  lines/<profile>.txt     the official syllabus split into lines, verbatim
                          "## <subject> <unit> | <official unit title> | <pdf page>" then one line per item
  lines/hi.tsv            English line text <TAB> Hindi translation (NTA publishes no Hindi syllabus)
  graph/<subject>.g       graph authoring file, format below; maths in $...$ (content-format section 3)
  ncert/*.tsv             NCERT 2026-27 chapter and section titles: Hindi-medium contents pages
                          (book, ref, title, page), English body headings, and fill-ins

Graph source format (one record per line, '|' separated, leading keyword; '#' starts a comment line):
  SUBJECT <id> | en=<name> | hi=<name> [| hisrc=ncert]
  UNIT <slug> | en= | hi= [| hisrc=ncert]
  CH <slug> | unit=<slug> | class=11 | ncert=<book>:<ch> | en= | hi= [| hisrc=ncert] [| note=...]
  XCH <book>:<ch> | <profile letters> | <reason> | en=<English chapter title>   NCERT chapter outside both syllabi
  TO <slug> | en= | hi= [| sec=<n.m>[,<n.m>]] [| hisrc=ncert]
  ST <slug> | en= | hi=
  CO <slug> | <kind> | <intrinsic depth> | en= | hi=
  S <english summary> || <hindi summary>
  K <english key point> || <hindi key point>
  P <prereq slug>[, ...]     (other subject: <subject>:<slug>)
  L <related slug>[, ...]
  R <ref>[, ...]             J2.4 = jee-main-2027 unit 2 item 4, N7.3 = neet-ug-2026, JN2.4 = both
  D J=3 N=2 | D 3            exam depth override (default: max(4, intrinsic))
  N <n.m>[, ...]             NCERT sections this concept teaches
  X <n.m> | <profile letters> | <reason>   NCERT section of this chapter outside the syllabus
"""

# ruff: noqa: E501 -- long official titles, URLs and messages are kept on one line
import collections
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "sources")
REPO = os.path.dirname(os.path.dirname(HERE))
CONTENT = os.path.join(REPO, "content")
UPDATED = "2026-10-30"  # date written into `updated`; change it when the sources change
RETRIEVED = "2026-10-29"  # when the official syllabi and NCERT books were downloaded
PROFILES = {"J": "jee-main-2027", "N": "neet-ug-2026"}
PROFILE_NAME = {"jee-main-2027": "JEE Main 2027", "neet-ug-2026": "NEET UG 2026"}
SYL_SOURCES = {
    "jee-main-2027": {
        "title": "Syllabus for JEE (Main) - 2027 (National Testing Agency, published 2026-10-24; linked from https://jeemain.nta.nic.in/)",
        "url": "https://cdnbbsr.s3waas.gov.in/s3f8e59f4b2fe7c5705bf878bbd494ccdf/uploads/2026/10/20261024683680768.pdf",
    },
    "neet-ug-2026": {
        "title": "Syllabus for NEET (UG)-2026 (NMC UGMEB public notice U-14023/19/NEET (UG Exam)/UGMEB dated 22 Dec 2025, uploaded by NTA 2026-01-08; linked from https://neet.nta.nic.in/)",
        "url": "https://cdnbbsr.s3waas.gov.in/s37bc1ec1d9c3426357e69acd5bf320061/uploads/2026/01/202601081066816297.pdf",
    },
}
SUBJ_OFFICIAL = {"phy": "physics", "chem": "chemistry", "math": "mathematics", "bio": "biology"}
COLOR_FAMILY = {"phy": "physics", "chem": "chemistry", "math": "maths", "bio": "biology"}
SUBJECT_SORT = {"phy": 1, "chem": 2, "math": 3, "bio": 4}
NCERT_BOOK = {
    "keph1": ("Physics Part I", 11),
    "keph2": ("Physics Part II", 11),
    "leph1": ("Physics Part I", 12),
    "leph2": ("Physics Part II", 12),
    "kech1": ("Chemistry Part I", 11),
    "kech2": ("Chemistry Part II", 11),
    "lech1": ("Chemistry Part I", 12),
    "lech2": ("Chemistry Part II", 12),
    "kebo1": ("Biology", 11),
    "lebo1": ("Biology", 12),
    "kemh1": ("Mathematics", 11),
    "lemh1": ("Mathematics Part I", 12),
    "lemh2": ("Mathematics Part II", 12),
}
BOOK_FIRST_CH = {
    "keph1": 1,
    "keph2": 8,
    "leph1": 1,
    "leph2": 9,
    "kech1": 1,
    "kech2": 7,
    "lech1": 1,
    "lech2": 6,
    "kebo1": 1,
    "lebo1": 1,
    "kemh1": 1,
    "lemh1": 1,
    "lemh2": 7,
}
HI_BOOK = {
    "keph1": "khph1",
    "keph2": "khph2",
    "leph1": "lhph1",
    "leph2": "lhph2",
    "kech1": "khch1",
    "kech2": "khch2",
    "lech1": "lhch1",
    "lech2": "lhch2",
    "kebo1": "khbo1",
    "lebo1": "lhbo1",
    "kemh1": "khmh1",
    "lemh1": "lhmh1",
    "lemh2": "lhmh2",
}
KINDS = {
    "fact",
    "definition",
    "formula",
    "derivation",
    "process",
    "skill",
    "date",
    "list",
    "diagram",
}
# inventory@1 kinds are item kinds; an NCERT section takes the kind of most of the concepts that teach it
INV_KIND = {
    "definition": "definition",
    "formula": "formula",
    "derivation": "formula",
    "list": "list",
    "date": "date",
    "diagram": "diagram",
    "fact": "fact",
    "process": "fact",
    "skill": "fact",
}
AUTHOR = "skill:syllabus-mapper"


def ncert_pdf(book, ch):
    return f"https://ncert.nic.in/textbook/pdf/{book}{ch - BOOK_FIRST_CH[book] + 1:02d}.pdf"


def read_rows(path):
    with open(path, encoding="utf-8") as fh:
        for raw in fh:
            if raw.startswith("#") or not raw.strip():
                continue
            yield raw.rstrip("\n").split("\t")


def write(rel, obj):
    path = os.path.join(CONTENT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def meta(sources, notes=None, status="draft"):
    out = {
        "status": status,
        "sources": sources,
        "authored_by": AUTHOR,
        "reviewed_by": None,
        "updated": UPDATED,
    }
    if notes:
        out["notes"] = notes
    return out


def syl_source(prof, pages=None):
    s = {
        "kind": "official",
        "ref": SYL_SOURCES[prof]["title"],
        "url": SYL_SOURCES[prof]["url"],
        "retrieved": RETRIEVED,
    }
    if pages:
        s["pages"] = pages
    return s


# ---------------------------------------------------------------- syllabus lines
def load_lines(profile):
    units = []
    with open(os.path.join(SRC, "lines", profile + ".txt"), encoding="utf-8") as fh:
        for raw in fh:
            ln = raw.rstrip("\n")
            if not ln.strip() or (ln.startswith("#") and not ln.startswith("## ")):
                continue
            if ln.startswith("## "):
                head, title, page = [x.strip() for x in ln[3:].split("|")]
                subj, unit = head.split()
                units.append(
                    {
                        "subject": subj,
                        "unit": int(unit),
                        "title": title,
                        "pdf_page": page,
                        "items": [],
                    }
                )
                continue
            u = units[-1]
            n = len(u["items"]) + 1
            u["items"].append(
                {"ref": f"{profile}:{u['subject']}:unit-{u['unit']}:item-{n}", "text": ln.strip()}
            )
    return units


# ---------------------------------------------------------------- graph source parser
def kv(parts):
    d = {}
    for p in parts:
        if "=" in p:
            k, v = p.split("=", 1)
            d[k.strip()] = v.strip()
    return d


def loc(en, hi):
    return {"en": en, "hi": hi}


def split_list(rest):
    return [x.strip() for x in rest.split(",") if x.strip()]


def parse_graph(path, errors):
    subj = None
    units, chapters = [], []
    ch = to = st = co = None
    with open(path, encoding="utf-8") as fh:
        rows = list(fh)
    for lineno, raw in enumerate(rows, 1):
        ln = raw.rstrip("\n")
        if not ln.strip() or ln.lstrip().startswith("#"):
            continue
        kw, _, rest = ln.strip().partition(" ")
        where = f"{os.path.basename(path)}:{lineno}"
        if kw in ("S", "K"):
            if " || " not in rest or co is None:
                errors.append(f"{where}: {kw} needs 'en || hi' inside a concept")
                continue
            en, hi = [x.strip() for x in rest.split(" || ", 1)]
            if kw == "S":
                co["summary"] = loc(en, hi)
            else:
                co["key_points"].append(loc(en, hi))
        elif kw == "P":
            co["prereq_slugs"] += split_list(rest)
        elif kw == "L":
            co["related_slugs"] += split_list(rest)
        elif kw == "R":
            for x in split_list(rest):
                co["refs"] += ["J" + x[2:], "N" + x[2:]] if x.startswith("JN") else [x]
        elif kw == "D":
            for p in rest.split():
                if "=" not in p:
                    for k in PROFILES:
                        co["depth_override"][k] = int(p)
                else:
                    k, v = p.split("=")
                    co["depth_override"][k] = int(v)
        elif kw == "X":
            parts = [x.strip() for x in rest.split("|")]
            ch["exclusions"].append({"section": parts[0], "profiles": parts[1], "reason": parts[2]})
        elif kw == "XCH":
            parts = [x.strip() for x in rest.split("|")]
            subj.setdefault("excluded_chapters", []).append(
                {
                    "ncert": parts[0],
                    "profiles": parts[1],
                    "reason": parts[2],
                    "en": kv(parts[3:])["en"],
                    "where": where,
                }
            )
        elif kw == "N":
            co["ncert_secs"] += split_list(rest)
        else:
            parts = [x.strip() for x in rest.split("|")]
            head, attrs = parts[0], kv(parts[1:])
            if kw == "SUBJECT":
                subj = {
                    "id": head,
                    "name": loc(attrs["en"], attrs["hi"]),
                    "hisrc": attrs.get("hisrc", "translated"),
                }
            elif kw == "UNIT":
                units.append(
                    {
                        "slug": head,
                        "name": loc(attrs["en"], attrs["hi"]),
                        "hisrc": attrs.get("hisrc", "translated"),
                    }
                )
            elif kw == "CH":
                ch = {
                    "slug": head,
                    "unit": attrs["unit"],
                    "class": attrs.get("class"),
                    "ncert": attrs.get("ncert"),
                    "name": loc(attrs["en"], attrs.get("hi", "")),
                    "hisrc": attrs.get("hisrc", "translated"),
                    "topics": [],
                    "exclusions": [],
                    "where": where,
                    "note": attrs.get("note"),
                }
                chapters.append(ch)
                to = st = co = None
            elif kw == "TO":
                to = {
                    "slug": head,
                    "name": loc(attrs["en"], attrs.get("hi", "")),
                    "sec": [s for s in attrs.get("sec", "").split(",") if s],
                    "hisrc": attrs.get("hisrc", "translated"),
                    "subtopics": [],
                    "where": where,
                }
                ch["topics"].append(to)
                st = co = None
            elif kw == "ST":
                st = {
                    "slug": head,
                    "name": loc(attrs["en"], attrs.get("hi", "")),
                    "concepts": [],
                    "where": where,
                }
                to["subtopics"].append(st)
                co = None
            elif kw == "CO":
                if st is None:
                    st = {
                        "slug": "core",
                        "name": dict(to["name"]),
                        "concepts": [],
                        "where": where,
                        "auto": True,
                    }
                    to["subtopics"].append(st)
                slug, kind, depth = parts[0], parts[1], int(parts[2])
                a = kv(parts[3:])
                co = {
                    "slug": slug,
                    "kind": kind,
                    "intrinsic_depth": depth,
                    "name": loc(a.get("en", ""), a.get("hi", "")),
                    "summary": None,
                    "key_points": [],
                    "prereq_slugs": [],
                    "related_slugs": [],
                    "refs": [],
                    "depth_override": {},
                    "ncert_secs": [],
                    "where": where,
                }
                st["concepts"].append(co)
            else:
                errors.append(f"{where}: unknown keyword {kw}")
    return subj, units, chapters


# ---------------------------------------------------------------- NCERT titles
def load_titles(errors):
    hi_titles = {}
    for fn in ("chem.tsv", "math_bio.tsv", "phy11.tsv", "phy12.tsv"):
        for book, ref, text, page in read_rows(os.path.join(SRC, "ncert", fn)):
            hi_titles[(book, ref)] = (text, page)
    en_secs = collections.defaultdict(dict)
    math_rows = list(read_rows(os.path.join(SRC, "ncert", "ncert_en_math.tsv")))
    manual_en = {(r[0], r[1]) for r in math_rows}
    for b, sec, t in list(read_rows(os.path.join(SRC, "ncert", "ncert_en_titles.tsv"))) + math_rows:
        # repair words the PDF text layer split or joined
        t = re.sub(r"’s([a-z])", lambda m: "’s " + m.group(1).upper(), t)  # noqa: RUF001
        t = re.sub(
            r"\bA(particle|variable|spring|system|rigid|fixed|travelling|uniform|point|capacitor|magnetic|circular|resistor|series|prism|rectifier)\b",
            lambda m: "a " + m.group(1).capitalize(),
            t,
        )
        key = (b, int(sec.split(".")[0]))
        if (b, sec) not in manual_en and (
            len(re.findall(r"\b[A-Za-z]\b", t)) >= 3
            or t.endswith(("–", ":", " the Periodic"))  # noqa: RUF001
            or "par Ticle" in t
            or t == "Kinematic"
        ):
            continue  # garbled or truncated heading; the topic name is used instead
        en_secs[key][sec] = t
    extra_secs = collections.defaultdict(dict)
    for b, sec, title in read_rows(os.path.join(SRC, "ncert", "ncert_bio_en.tsv")):
        extra_secs[(b, int(sec.split(".")[0]))][sec] = title
    extra_secs[("keph1", 2)]["2.5"] = "Relative velocity"
    for key, d in extra_secs.items():
        en_secs[key].update(d)
    return hi_titles, en_secs, extra_secs, manual_en


def main():
    errors, warnings = [], []
    hi_titles, en_secs, extra_secs, manual_en = load_titles(errors)
    line_hi = {r[0]: r[1] for r in read_rows(os.path.join(SRC, "lines", "hi.tsv"))}
    lines = {p: load_lines(p) for p in PROFILES.values()}
    line_index = {it["ref"]: (u, it) for us in lines.values() for u in us for it in u["items"]}

    parsed = [
        parse_graph(os.path.join(SRC, "graph", fn), errors)
        for fn in sorted(os.listdir(os.path.join(SRC, "graph")))
        if fn.endswith(".g")
    ]

    slug_to_id = {}
    for subj, _units, chapters in parsed:
        sid = subj["id"]
        for ch in chapters:
            for to in ch["topics"]:
                for st in to["subtopics"]:
                    for co in st["concepts"]:
                        key = (sid, co["slug"])
                        if key in slug_to_id:
                            errors.append(
                                f"{co['where']}: duplicate concept slug {co['slug']} in {sid}"
                            )
                        slug_to_id[key] = (
                            f"{sid}.{ch['slug']}.{to['slug']}.{st['slug']}.{co['slug']}"
                        )

    def resolve(sid, s, where):
        key = tuple(s.split(":", 1)) if ":" in s else (sid, s)
        if key not in slug_to_id:
            errors.append(f"{where}: unknown concept reference {s}")
            return None
        return slug_to_id[key]

    all_concepts = {}
    exam_concepts = collections.defaultdict(dict)
    line_to_concepts = collections.defaultdict(list)
    chapter_meta = []

    for subj, units, chapters in parsed:
        sid = subj["id"]
        offname = SUBJ_OFFICIAL[sid]
        unit_ids = {u["slug"]: f"{sid}.{u['slug']}" for u in units}
        ch_ids = []
        subj_profiles = set()
        for ch in chapters:
            chid = f"{sid}.{ch['slug']}"
            book, ncert_ch = ch["ncert"].split(":") if ch["ncert"] else (None, None)
            ncert_ref, ch_sources, hisrc = None, [], ch["hisrc"]
            name = dict(ch["name"])
            if book:
                ncert_ch = int(ncert_ch)
                bname, cls = NCERT_BOOK[book]
                ncert_ref = f"NCERT Class {cls} {bname}, Ch {ncert_ch}"
                ch_sources.append(
                    {
                        "kind": "ncert",
                        "ref": ncert_ref + " (2026-27 reprint)",
                        "url": ncert_pdf(book, ncert_ch),
                        "retrieved": RETRIEVED,
                    }
                )
                h = hi_titles.get((HI_BOOK[book], f"ch{ncert_ch}"))
                if h:
                    name["hi"] = h[0]
                    hisrc = "ncert"
                    ch_sources.append(
                        {
                            "kind": "ncert",
                            "ref": f"NCERT Class {cls} Hindi-medium {HI_BOOK[book]} contents (chapter title)",
                            "url": f"https://ncert.nic.in/textbook/pdf/{HI_BOOK[book]}ps.pdf",
                            "retrieved": RETRIEVED,
                            "pages": h[1],
                        }
                    )
            if not name["hi"]:
                errors.append(f"{ch['where']}: chapter {chid} has no Hindi name")
            units_cov = collections.defaultdict(set)
            topics_out, hi_ncert_topics = [], []
            for to in ch["topics"]:
                tid = f"{chid}.{to['slug']}"
                tname = dict(to["name"])
                if to["hisrc"] == "ncert":
                    h = hi_titles.get((HI_BOOK[book], to["sec"][0])) if book and to["sec"] else None
                    if not h:
                        errors.append(
                            f"{to['where']}: topic {tid} says hisrc=ncert but no NCERT Hindi title found"
                        )
                    else:
                        tname["hi"] = h[0]
                        hi_ncert_topics.append(
                            f"{to['slug']} (§{to['sec'][0]}, {HI_BOOK[book]} contents {h[1]})"
                        )
                if not tname["hi"]:
                    errors.append(f"{to['where']}: topic {tid} has no Hindi name")
                subs_out = []
                for st in to["subtopics"]:
                    stid = f"{tid}.{st['slug']}"
                    concepts_out = []
                    for co in st["concepts"]:
                        cid = f"{stid}.{co['slug']}"
                        w = co["where"]
                        if co["kind"] not in KINDS:
                            errors.append(f"{w}: bad kind {co['kind']}")
                        if not 1 <= co["intrinsic_depth"] <= 5:
                            errors.append(f"{w}: bad depth")
                        if not co["name"]["en"] or not co["name"]["hi"]:
                            errors.append(f"{w}: concept {cid} missing name")
                        if not co["summary"]:
                            errors.append(f"{w}: concept {cid} missing summary")
                        if len(co["key_points"]) < 2:
                            errors.append(f"{w}: concept {cid} needs at least 2 key points")
                        refs = []
                        for r in co["refs"]:
                            m = re.fullmatch(r"([JN])(\d+)\.(\d+)", r)
                            if not m:
                                errors.append(f"{w}: bad ref {r}")
                                continue
                            prof = PROFILES[m.group(1)]
                            full = f"{prof}:{offname}:unit-{m.group(2)}:item-{m.group(3)}"
                            if full not in line_index:
                                errors.append(f"{w}: ref {r} -> {full} does not exist")
                                continue
                            if full not in refs:
                                refs.append(full)
                            line_to_concepts[full].append(cid)
                            units_cov[prof].add(int(m.group(2)))
                            subj_profiles.add(prof)
                        prereqs = list(
                            dict.fromkeys(
                                x for x in (resolve(sid, s, w) for s in co["prereq_slugs"]) if x
                            )
                        )
                        related = list(
                            dict.fromkeys(
                                x for x in (resolve(sid, s, w) for s in co["related_slugs"]) if x
                            )
                        )
                        if cid in prereqs:
                            errors.append(f"{w}: {cid} is its own prerequisite")
                        c_out = {
                            "id": cid,
                            "name": co["name"],
                            "kind": co["kind"],
                            "intrinsic_depth": co["intrinsic_depth"],
                            "summary": co["summary"],
                            "key_points": co["key_points"],
                            "prerequisites": prereqs,
                            "related": related,
                            "syllabus_refs": refs,
                        }
                        concepts_out.append(c_out)
                        all_concepts[cid] = (c_out, co, tid)
                        for letter, prof in PROFILES.items():
                            if any(r.startswith(prof + ":") for r in refs):
                                depth = co["depth_override"].get(
                                    letter, max(4, co["intrinsic_depth"])
                                )
                                if depth < co["intrinsic_depth"]:
                                    warnings.append(
                                        f"{w}: {letter} depth {depth} below intrinsic {co['intrinsic_depth']}"
                                    )
                                exam_concepts[prof][cid] = {
                                    "id": cid,
                                    "depth": depth,
                                    "priority": "core",
                                    "weightage": None,
                                    "pyq_count": None,
                                }
                        if not refs:
                            warnings.append(f"{w}: concept {cid} has no syllabus refs (graph-only)")
                    subs_out.append(
                        {
                            "id": stid,
                            "name": tname if st.get("auto") else st["name"],
                            "concepts": concepts_out,
                        }
                    )
                topics_out.append({"id": tid, "name": tname, "subtopics": subs_out})
            syl_sources = []
            for prof, us in sorted(units_cov.items()):
                for un in sorted(us):
                    u = next(x for x in lines[prof] if x["subject"] == offname and x["unit"] == un)
                    syl_sources.append(
                        syl_source(
                            prof,
                            f"PDF p.{u['pdf_page']}: {offname.title()} Unit {un}, {u['title']}",
                        )
                    )
            notes = []
            if ch.get("class"):
                notes.append(f"NCERT class {ch['class']}.")
            if ch.get("note"):
                notes.append(ch["note"])
            notes.append(
                "Chapter name in Hindi: "
                + ("NCERT Hindi-medium contents page." if hisrc == "ncert" else "translated.")
            )
            if hi_ncert_topics:
                notes.append(
                    "Topic names in Hindi taken from the NCERT Hindi-medium contents: "
                    + ", ".join(hi_ncert_topics)
                    + "."
                )
            notes.append(
                "Other topic, subtopic and concept text is written by skill:syllabus-mapper from the cited NCERT chapter and translated into Hindi. "
                f"The NCERT section each concept teaches is recorded in coverage/inventory/{sid}/{ch['slug']}.json."
            )
            ch_out = {
                "schema": "chapter@1",
                "id": chid,
                "subject": sid,
                "unit": unit_ids.get(ch["unit"]),
                "name": name,
                "ncert_ref": ncert_ref,
                "topics": topics_out,
            }
            if ch_out["unit"] is None:
                errors.append(f"{ch['where']}: unknown unit {ch['unit']}")
            ch_out.update(meta(ch_sources + syl_sources, " ".join(notes)))
            write(f"graph/{sid}/{ch['slug']}.json", ch_out)
            ch_ids.append(chid)
            chapter_meta.append((sid, ch, chid, book, ncert_ch, topics_out))
        notes = [
            "Subject name in Hindi: "
            + ("NCERT Hindi-medium books." if subj["hisrc"] == "ncert" else "translated.")
        ]
        ncert_units = [u["slug"] for u in units if u["hisrc"] == "ncert"]
        if ncert_units:
            notes.append(
                "Unit names in Hindi taken from the NCERT Hindi-medium books: "
                + ", ".join(ncert_units)
                + "; the others are translated."
            )
        for xc in subj.get("excluded_chapters", []):
            b, n = xc["ncert"].split(":")
            h = hi_titles.get((HI_BOOK[b], f"ch{n}"))
            if not h:
                errors.append(f"{xc['where']}: no NCERT Hindi title for {xc['ncert']}")
                continue
            profs = ", ".join(PROFILE_NAME[PROFILES[x]] for x in xc["profiles"])
            notes.append(
                f"NCERT Class {NCERT_BOOK[b][1]} {NCERT_BOOK[b][0]}, Ch {n} '{xc['en']}' ({h[0]}; {ncert_pdf(b, int(n))}) has no graph chapter: "
                f"{xc['reason']} ({profs})."
            )
        subj_out = {
            "schema": "subject@1",
            "id": sid,
            "name": subj["name"],
            "color_family": COLOR_FAMILY[sid],
            "sort": SUBJECT_SORT[sid],
            "units": [{"id": unit_ids[u["slug"]], "name": u["name"]} for u in units],
            "chapters": ch_ids,
        }
        subj_out.update(
            meta([syl_source(p) for p in PROFILES.values() if p in subj_profiles], " ".join(notes))
        )
        write(f"graph/{sid}/subject.json", subj_out)

    # prerequisite cycles
    graph = {c: v[0]["prerequisites"] for c, v in all_concepts.items()}
    state = {}

    def visit(n, stack):
        state[n] = 1
        for m in graph.get(n, []):
            if state.get(m) == 1:
                errors.append(f"prerequisite cycle: {' -> '.join([*stack, n, m])}")
            elif state.get(m) is None:
                visit(m, [*stack, n])
        state[n] = 2

    for c in graph:
        if state.get(c) is None:
            visit(c, [])

    # inventory: every numbered section of each mapped NCERT chapter
    inv_counts = collections.Counter()
    for sid, ch, chid, book, ncert_ch, topics_out in chapter_meta:
        if not book:
            continue
        bname, cls = NCERT_BOOK[book]
        url = ncert_pdf(book, ncert_ch)
        topic_secs = {to["slug"]: to["sec"] for to in ch["topics"]}
        topic_en, topic_en_single = {}, {}
        sec_to_concepts = collections.defaultdict(list)
        for t in topics_out:
            secs = topic_secs[t["id"].rsplit(".", 1)[1]]
            for sec in secs:
                topic_en.setdefault(sec, t["name"]["en"])
                if len(secs) == 1:
                    topic_en_single.setdefault(sec, t["name"]["en"])
            for st in t["subtopics"]:
                for c in st["concepts"]:
                    for sec in all_concepts[c["id"]][1]["ncert_secs"]:
                        sec_to_concepts[sec].append(c["id"])
            for sec in secs:
                for st in t["subtopics"]:
                    for c in st["concepts"]:
                        if c["id"] not in sec_to_concepts[sec]:
                            sec_to_concepts[sec].append(c["id"])
        hb = HI_BOOK[book]
        secs = sorted(
            {k for (b, k) in hi_titles if b == hb and re.fullmatch(rf"{ncert_ch}\.\d+", k)}
            | set(extra_secs[(book, ncert_ch)].keys()),
            key=lambda s: [int(x) for x in s.split(".")],
        )
        excl = {e["section"]: e for e in ch["exclusions"]}
        items = []
        for sec in secs:
            title_en = (
                topic_en_single.get(sec) or en_secs[(book, ncert_ch)].get(sec) or topic_en.get(sec)
            )
            if (book, sec) in manual_en:
                title_en = en_secs[(book, ncert_ch)][sec]
            if not title_en:
                errors.append(f"inventory {book} {sec}: no English title")
                continue
            title_hi = hi_titles.get((hb, sec), (None,))[0]
            cs = list(dict.fromkeys(sec_to_concepts.get(sec, [])))
            item = {
                "id": f"{book}-{sec.replace('.', '-')}",
                "kind": "fact",
                "title": title_en,
                "source_ref": f"NCERT Class {cls} {bname}, Ch {ncert_ch} §{sec} ({url})",
                "concepts": cs,
            }
            if cs:
                kinds = collections.Counter(INV_KIND[all_concepts[c][0]["kind"]] for c in cs)
                item["kind"] = kinds.most_common(1)[0][0]
                inv_counts["mapped"] += 1
            elif sec.endswith(".1") and (
                title_hi in ("भूमिका", "सामान्य प्रस्तावना")
                or title_en.lower().startswith("introduction")
            ):
                item["out_of_syllabus"] = "Chapter introduction with no separate teachable item."
                inv_counts["introduction"] += 1
            elif sec in excl:
                profs = ", ".join(PROFILE_NAME[PROFILES[x]] for x in excl[sec]["profiles"])
                item["out_of_syllabus"] = f"{excl[sec]['reason']} ({profs})"
                inv_counts["out_of_syllabus"] += 1
            else:
                errors.append(
                    f"inventory {chid} §{sec} '{title_en}': maps to no concept and has no exclusion"
                )
            items.append(item)
        if not items:
            continue
        inv = {"schema": "inventory@1", "chapter": chid, "items": items}
        inv.update(
            meta(
                [
                    {
                        "kind": "ncert",
                        "ref": f"NCERT Class {cls} {bname}, Ch {ncert_ch} (2026-27 reprint): numbered sections from the chapter and the Hindi-medium contents pages",
                        "url": url,
                        "retrieved": RETRIEVED,
                    }
                ],
                "One item per numbered NCERT section (x.y), the granularity this inventory is built at. "
                "Hindi section titles from the NCERT Hindi-medium contents are not kept, because inventory@1 titles are a single string.",
            )
        )
        write(f"coverage/inventory/{sid}/{ch['slug']}.json", inv)

    # exam maps and syllabus files
    for prof in PROFILES.values():
        em = {
            "schema": "exam-map@1",
            "exam_profile": prof,
            "stats_basis": None,
            "concepts": sorted(exam_concepts[prof].values(), key=lambda c: c["id"]),
        }
        em.update(
            meta(
                [syl_source(prof)],
                "Depth is 4 by default (the highest level the exam needs, per the syllabus-mapper depth table: L3 easy and medium, L4 hard); "
                "it is lowered only where the official syllabus line limits treatment (for example 'qualitative idea only', 'elementary idea', "
                "'no derivation', 'brief account', 'recall only'). Priority is core for every concept: the official syllabus marks nothing optional. "
                "weightage and pyq_count stay null until pyq-ingest computes them.",
            )
        )
        write(f"exam-maps/{prof}.json", em)
        out_lines, unit_notes = [], []
        for u in lines[prof]:
            unit_notes.append(
                f"{u['subject']} unit {u['unit']}: {u['title']} (PDF p.{u['pdf_page']})"
            )
            for it in u["items"]:
                hi = line_hi.get(it["text"])
                if not hi:
                    errors.append(
                        f"syllabus line {it['ref']} has no Hindi translation in sources/lines/hi.tsv"
                    )
                    hi = it["text"]
                cs = list(dict.fromkeys(line_to_concepts.get(it["ref"], [])))
                if not cs:
                    warnings.append(f"syllabus line {it['ref']} maps to no concept")
                out_lines.append(
                    {"ref": it["ref"], "text": {"en": it["text"], "hi": hi}, "concepts": cs}
                )
        syl = {"schema": "syllabus@1", "exam_profile": prof, "lines": out_lines}
        syl.update(
            meta(
                [syl_source(prof)],
                "Each line is a verbatim fragment of the official English syllabus, split at teachable boundaries; refs are "
                "{exam_profile}:{subject}:unit-{n}:item-{m}. The Hindi text is our translation: the official syllabus is published in English only. "
                "Units (official titles and PDF pages): " + "; ".join(unit_notes) + ".",
            )
        )
        write(f"coverage/syllabus/{prof}.json", syl)
        print(
            prof,
            "concepts:",
            len(em["concepts"]),
            "lines:",
            len(out_lines),
            "unmapped lines:",
            sum(1 for x in out_lines if not x["concepts"]),
        )

    print("concepts total:", len(all_concepts), "inventory:", dict(inv_counts))
    for w in warnings[:40]:
        print("WARN", w)
    if len(warnings) > 40:
        print("WARN ...", len(warnings) - 40, "more")
    for e in errors:
        print("ERROR", e)
    print("errors:", len(errors), "warnings:", len(warnings))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
