"""content-qa checks for the syllabus-map stage (skills/content-qa checks 1, 2, 3 in part, 5, 12 and 13).

These complement `pnpm content:check` (schemas, references, locales, maths parity, coverage) with the
editorial checks it does not make: plain-text formulas, invented statistics, source URLs, number parity
in every localised field, and blueprint arithmetic.

Usage:  python3 -I tools/content-research/qa.py
Prints one finding per line as: severity | check | file | id | problem, then a summary.
Reads only files under content/ (no network). Exit status 1 when there is a blocker.
"""

# ruff: noqa: E501 -- long finding messages are kept on one line
import collections
import glob
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CONTENT = os.path.join(REPO, "content")
findings = []

ID_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)*$")
COMMON = ["schema", "status", "sources", "authored_by", "reviewed_by", "updated"]
SRC_KINDS = {"ncert", "official", "openstax", "pyq", "textbook", "paper", "dataset", "other"}
NUM_RE = re.compile(r"\d+(?:\.\d+)?")
MATH_SEG = re.compile(r"\$\$.+?\$\$|\$.+?\$")
# plain-text maths outside $...$: operators, roots, integrals, sums, Unicode super/subscripts, simple a + b or a - b,
# derivatives. A hyphen between two single letters with no spaces is a name, not a formula (x-t graph, p-n junction).
MATH_RE = re.compile(
    r"[=√∫Σ²³ⁿ⁻¹₀₁₂₃]|\b[a-z]\s*[+−]\s*[a-z]\b|\b[a-z]\s+-\s+[a-z]\b|d[xy]/d[xyt]"  # noqa: RUF001
)
FORMULA_SUBJECTS = ("phy", "chem", "math")
STAT_PATTERNS = (
    r"\basked\b.*\btimes\b",
    r"high[- ]yield",
    r"\b(ranks?|ranked) (\d|first|top|number)",
    r"most important",
    r"frequently asked",
)


def add(sev, check, path, ident, msg):
    findings.append((sev, check, os.path.relpath(path, REPO), ident, msg))


def load(p):
    with open(p, encoding="utf-8") as fh:
        return json.load(fh)


def files(pattern):
    return sorted(glob.glob(os.path.join(CONTENT, pattern)))


def loc_ok(o):
    return isinstance(o, dict) and all(
        isinstance(o.get(k), str) and o[k].strip() for k in ("en", "hi")
    )


def plain(s):
    return MATH_SEG.sub(" ", s)


def nums(s):
    return sorted(NUM_RE.findall(s))


def check_common(p, d):
    for k in COMMON:
        if k not in d:
            add("blocker", 1, p, d.get("id", ""), f"missing common field {k}")
    srcs = d.get("sources") or []
    if not srcs:
        add("blocker", 3, p, d.get("id", ""), "no sources")
    for s in srcs:
        if s.get("kind") not in SRC_KINDS:
            add("blocker", 1, p, d.get("id", ""), f"bad source kind {s.get('kind')}")
        if not s.get("url"):
            add("major", 3, p, d.get("id", ""), f"source without URL: {s.get('ref')}")


def parity(p, ident, o, what):
    if not loc_ok(o):
        add("blocker", 5, p, ident, f"{what}: missing en or hi")
        return
    if o["en"].count("$") % 2 or o["hi"].count("$") % 2:
        add("blocker", 1, p, ident, f"{what}: unbalanced $")
    if nums(o["en"]) != nums(o["hi"]):
        add("blocker", 5, p, ident, f"{what}: numbers differ en={nums(o['en'])} hi={nums(o['hi'])}")


def formula_text(p, ident, o, what):
    if MATH_RE.search(plain(o["en"])):
        add(
            "major",
            1,
            p,
            ident,
            f"{what}: formula written as plain text; content-format section 3 asks for LaTeX in $...$",
        )


# ---- syllabus lines
lines = {}
for p in files("coverage/syllabus/*.json"):
    d = load(p)
    check_common(p, d)
    for ln in d["lines"]:
        lines[ln["ref"]] = ln
        parity(p, ln["ref"], ln["text"], "line text")

# ---- graph
concepts, chapters_seen, subjects = {}, {}, {}
for p in files("graph/*/*.json"):
    d = load(p)
    check_common(p, d)
    if d["schema"] == "subject@1":
        subjects[d["id"]] = (p, d)
        continue
    chapters_seen[d["id"]] = (p, d)
    parity(p, d["id"], d["name"], "chapter name")
    if not d.get("ncert_ref") and not d.get("notes"):
        add(
            "major",
            3,
            p,
            d["id"],
            "chapter has neither an NCERT reference nor a note explaining why",
        )
    for t in d["topics"]:
        if not t["id"].startswith(d["id"] + "."):
            add("blocker", 1, p, t["id"], "topic id not under chapter")
        parity(p, t["id"], t["name"], "topic name")
        for st in t["subtopics"]:
            if not st["id"].startswith(t["id"] + "."):
                add("blocker", 1, p, st["id"], "subtopic id not under topic")
            parity(p, st["id"], st["name"], "subtopic name")
            for c in st["concepts"]:
                cid = c["id"]
                if not ID_RE.match(cid) or not cid.startswith(st["id"] + "."):
                    add("blocker", 1, p, cid, "bad concept id")
                if cid in concepts:
                    add("blocker", 1, p, cid, "duplicate concept id")
                concepts[cid] = (p, c, d["subject"])
                parity(p, cid, c["name"], "name")
                parity(p, cid, c["summary"], "summary")
                if len(c["key_points"]) < 2:
                    add("major", 2, p, cid, "fewer than two key points")
                for i, kp in enumerate(c["key_points"]):
                    parity(p, cid, kp, f"key_point {i + 1}")
                for r in c["syllabus_refs"]:
                    if r not in lines:
                        add(
                            "blocker",
                            2,
                            p,
                            cid,
                            f"syllabus ref {r} is not a line in coverage/syllabus",
                        )
                txt = c["summary"]["en"] + " " + " ".join(k["en"] for k in c["key_points"])
                for pat in STAT_PATTERNS:
                    if re.search(pat, txt, re.I):
                        add(
                            "blocker",
                            12,
                            p,
                            cid,
                            f"possible invented statistic or ranking: /{pat}/",
                        )
                if d["subject"] in FORMULA_SUBJECTS:
                    formula_text(p, cid, c["summary"], "summary")
                    for i, kp in enumerate(c["key_points"]):
                        formula_text(p, cid, kp, f"key_point {i + 1}")

for cid, (p, c, _) in concepts.items():
    for r in c["prerequisites"] + c.get("related", []):
        if r not in concepts:
            add("blocker", 2, p, cid, f"reference {r} does not resolve")
    if cid in c["prerequisites"]:
        add("blocker", 2, p, cid, "own prerequisite")

for sid, (p, d) in subjects.items():
    parity(p, sid, d["name"], "subject name")
    for u in d["units"]:
        parity(p, u["id"], u["name"], "unit name")
    for ch in d["chapters"]:
        if ch not in chapters_seen:
            add("blocker", 2, p, ch, "chapter listed but file missing")

# ---- exam maps and coverage inputs
exam_map_concepts = collections.defaultdict(set)
for p in files("exam-maps/*.json"):
    d = load(p)
    check_common(p, d)
    prof = d["exam_profile"]
    for c in d["concepts"]:
        exam_map_concepts[prof].add(c["id"])
        if c["id"] not in concepts:
            add("blocker", 2, p, c["id"], "exam-map concept not in graph")
        if (c["weightage"] is not None or c["pyq_count"] is not None) and not d.get("stats_basis"):
            add("blocker", 12, p, c["id"], "weightage or pyq_count set without stats_basis")
        if c["priority"] == "high_yield" and not d.get("stats_basis"):
            add("blocker", 12, p, c["id"], "high_yield without PYQ data")
        refs = concepts.get(c["id"], (None, {"syllabus_refs": []}, None))[1]["syllabus_refs"]
        if not any(r.startswith(prof + ":") for r in refs):
            add("blocker", 2, p, c["id"], "concept in exam map has no syllabus ref for this exam")

for ref, ln in lines.items():
    prof = ref.split(":")[0]
    if prof in exam_map_concepts and not ln["concepts"]:
        add(
            "blocker",
            2,
            "content/coverage/syllabus/" + prof + ".json",
            ref,
            "syllabus line maps to no concept",
        )
    for c in ln["concepts"]:
        if c not in concepts:
            add(
                "blocker",
                2,
                "content/coverage/syllabus/" + prof + ".json",
                ref,
                f"line concept {c} not in graph",
            )

inventoried = set()
for p in files("coverage/inventory/*/*.json"):
    d = load(p)
    check_common(p, d)
    if "excluded_chapters" in d:  # subject-level list of NCERT chapters with no graph chapter
        for x in d["excluded_chapters"]:
            if not x.get("reason") or not x.get("exam_profiles"):
                add(
                    "blocker",
                    2,
                    p,
                    x["ref"],
                    "excluded chapter needs a reason and its exam profiles",
                )
        continue
    for it in d["items"]:
        t = it["title"]
        if isinstance(t, dict) and not (t.get("en") and t.get("hi")):
            add("blocker", 2, p, it["id"], "paired title needs both en and hi")
    inventoried.add(d["chapter"])
    if d["chapter"] not in chapters_seen:
        add("blocker", 2, p, d["chapter"], "inventory for an unknown chapter")
    for it in d["items"]:
        if not it["concepts"] and not it.get("out_of_syllabus"):
            add(
                "blocker",
                2,
                p,
                it["id"],
                "inventory item maps to no concept and has no exclusion reason",
            )
        for c in it["concepts"]:
            if c not in concepts:
                add("blocker", 2, p, it["id"], f"inventory concept {c} not in graph")
            elif not c.startswith(d["chapter"] + "."):
                add("minor", 2, p, it["id"], f"inventory concept {c} is outside the chapter")
for chid, (p, d) in chapters_seen.items():
    if d.get("ncert_ref") and chid not in inventoried:
        add("major", 2, p, chid, "chapter has an NCERT reference but no inventory")

# ---- exams and blueprints
profiles = {}
for p in files("exams/*.json"):
    d = load(p)
    check_common(p, d)
    parity(p, d["id"], d["name"], "exam name")
    for pr in d["profiles"]:
        profiles[pr["id"]] = pr
        for s in pr.get("schedule") or []:
            if not s.get("source_url"):
                add("blocker", 13, p, pr["id"], f"schedule {s['kind']} without source_url")
for p in files("blueprints/*/*.json"):
    d = load(p)
    check_common(p, d)
    if d["exam_profile"] not in profiles:
        add("blocker", 13, p, d["exam_profile"], "blueprint profile not declared in exams/")
    elif d["paper_code"] not in profiles[d["exam_profile"]].get("papers", []):
        add("blocker", 13, p, d["paper_code"], "paper not listed on its exam profile")
    src = d.get("source", {})
    if not (src.get("url") and src.get("pages") and src.get("published")):
        add(
            "blocker",
            13,
            p,
            d["paper_code"],
            "blueprint source lacks url, pages or publication date",
        )
    parity(p, d["paper_code"], d.get("instructions"), "instructions")
    q = sum((s.get("question_count") or 0) for s in d["sections"])
    named = {q.get("field") for q in d.get("open_questions") or []}
    if d.get("question_count") is None:
        # "not stated" rule: a fact the notice does not state is null and an open question names it
        if "question_count" not in named:
            add(
                "blocker",
                13,
                p,
                d["paper_code"],
                "question_count is null without an open_questions entry for it",
            )
    elif q != d["question_count"]:
        add(
            "blocker",
            13,
            p,
            d["paper_code"],
            f"sections hold {q} questions, question_count says {d['question_count']}",
        )
    for s in d["sections"]:
        parity(p, s["code"], s["title"], "section title")
        types = s.get("question_types", [])
        if types and all(t == "skill_test" for t in types):
            continue  # qualifying skill test: no questions or marks, judged by its cutoff
        for t in types:
            if t not in s.get("marking", {}):
                add("blocker", 13, p, s["code"], f"question type {t} has no marking rule")

sev_order = {"blocker": 0, "major": 1, "minor": 2}
findings.sort(key=lambda x: (sev_order[x[0]], x[1], x[2], x[3]))
by = collections.Counter((x[0], x[1]) for x in findings)
for x in findings:
    print(" | ".join(str(y) for y in x))
print(
    "SUMMARY",
    dict(sorted(by.items())),
    "concepts:",
    len(concepts),
    "chapters:",
    len(chapters_seen),
    "lines:",
    len(lines),
)
sys.exit(1 if any(x[0] == "blocker" for x in findings) else 0)
