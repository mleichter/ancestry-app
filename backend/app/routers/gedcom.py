import io
import json
import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.person import Person, GenderEnum
from app.models.relationship import Relationship, RelationshipType

router = APIRouter(tags=["gedcom"])

# ── Date conversion helpers ────────────────────────────────────────────────────

_M2G = ['', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
_G2M = {m: str(i).zfill(2) for i, m in enumerate(_M2G) if i}


def _to_ged_date(d: str | None) -> str:
    if not d:
        return ''
    parts = d.split('-')
    if len(parts) == 1:
        return parts[0]
    # Detect YYYY-MM-DD vs DD-MM-YYYY by checking if first part is 4-digit year
    if len(parts[0]) == 4:
        if len(parts) == 2:
            return f"{_M2G[int(parts[1])]} {parts[0]}"
        return f"{int(parts[2])} {_M2G[int(parts[1])]} {parts[0]}"
    # Legacy DD-MM-YYYY format
    if len(parts) >= 3:
        return f"{int(parts[0])} {_M2G[int(parts[1])]} {parts[2]}"
    return d


def _from_ged_date(v: str) -> str | None:
    if not v:
        return None
    parts = v.upper().split()
    if len(parts) == 1 and parts[0].isdigit():
        return parts[0]
    if len(parts) == 2 and parts[0] in _G2M and parts[1].isdigit():
        return f"{parts[1]}-{_G2M[parts[0]]}"
    if len(parts) == 3 and parts[1] in _G2M and parts[2].isdigit():
        return f"{parts[2]}-{_G2M[parts[1]]}-{parts[0].zfill(2)}"
    return None


def _strip_xref(value: str) -> str | None:
    v = value.strip()
    if v.startswith('@') and v.endswith('@'):
        return v[1:-1]
    return v or None


# ── GEDCOM export ──────────────────────────────────────────────────────────────

@router.get("/gedcom/export")
async def export_gedcom(db: AsyncSession = Depends(get_db)):
    persons = (await db.execute(select(Person))).scalars().all()
    rels = (await db.execute(select(Relationship))).scalars().all()

    idx: dict[str, int] = {str(p.id): i + 1 for i, p in enumerate(persons)}
    SEX = {'male': 'M', 'female': 'F', 'other': 'U', 'unknown': 'U'}

    lines: list[str] = [
        "0 HEAD",
        "1 SOUR ancestry-app",
        "2 NAME Stammbaum",
        "1 GEDC",
        "2 VERS 5.5.1",
        "1 CHAR UTF-8",
        f"1 DATE {datetime.utcnow().strftime('%d %b %Y').upper()}",
    ]

    for p in persons:
        n = idx[str(p.id)]
        lines += [f"0 @I{n}@ INDI"]
        surname = p.birth_name or p.last_name
        lines += [f"1 NAME {p.first_name} /{surname}/"]
        if p.gender:
            lines += [f"1 SEX {SEX.get(p.gender, 'U')}"]
        if p.date_of_birth:
            lines += ["1 BIRT", f"2 DATE {_to_ged_date(p.date_of_birth)}"]
            if p.place_of_birth:
                lines += [f"2 PLAC {p.place_of_birth}"]
        if p.date_of_death:
            lines += ["1 DEAT Y", f"2 DATE {_to_ged_date(p.date_of_death)}"]
            if p.place_of_death:
                lines += [f"2 PLAC {p.place_of_death}"]
        elif not p.is_living:
            lines += ["1 DEAT Y"]
        if p.biography:
            lines += [f"1 NOTE {p.biography[:250]}"]

    partner_rels = [r for r in rels if r.type == RelationshipType.partner]
    pc_rels = [r for r in rels if r.type == RelationshipType.parent_child]
    fam_n = 1
    assigned: set[str] = set()

    for rel in partner_rels:
        a, b = str(rel.person_a_id), str(rel.person_b_id)
        an, bn = idx.get(a), idx.get(b)
        if not an or not bn:
            continue
        lines += [f"0 @F{fam_n}@ FAM", f"1 HUSB @I{an}@", f"1 WIFE @I{bn}@"]
        if rel.start_date:
            lines += ["1 MARR", f"2 DATE {_to_ged_date(rel.start_date)}"]
        for pc in pc_rels:
            cid = str(pc.person_b_id)
            if str(pc.person_a_id) in {a, b} and cid not in assigned:
                cn = idx.get(cid)
                if cn:
                    lines += [f"1 CHIL @I{cn}@"]
                    assigned.add(cid)
        fam_n += 1

    partner_ids = {str(r.person_a_id) for r in partner_rels} | {str(r.person_b_id) for r in partner_rels}
    solo: dict[str, list[str]] = {}
    for pc in pc_rels:
        pid, cid = str(pc.person_a_id), str(pc.person_b_id)
        if pid not in partner_ids and cid not in assigned:
            solo.setdefault(pid, []).append(cid)
            assigned.add(cid)
    for pid, children in solo.items():
        pn = idx.get(pid)
        if not pn:
            continue
        lines += [f"0 @F{fam_n}@ FAM", f"1 HUSB @I{pn}@"]
        for cid in children:
            cn = idx.get(cid)
            if cn:
                lines += [f"1 CHIL @I{cn}@"]
        fam_n += 1

    lines += ["0 TRLR"]
    body = "\r\n".join(lines) + "\r\n"
    return StreamingResponse(
        io.BytesIO(body.encode("utf-8")),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=stammbaum.ged"},
    )


# ── GEDCOM import ──────────────────────────────────────────────────────────────

def _parse_records(content: str) -> list[dict]:
    records: list[dict] = []
    stack: list[dict] = []
    for raw in content.splitlines():
        line = raw.strip()
        if not line:
            continue
        parts = line.split(' ', 2)
        if len(parts) < 2:
            continue
        try:
            level = int(parts[0])
        except ValueError:
            continue
        rest = parts[1:]
        if rest[0].startswith('@') and rest[0].endswith('@') and len(rest) >= 2:
            xref, tag, val = rest[0][1:-1], rest[1], (rest[2] if len(rest) > 2 else '')
        else:
            xref, tag, val = None, rest[0], (rest[1] if len(rest) > 1 else '')
        rec: dict = {'level': level, 'xref': xref, 'tag': tag, 'value': val, 'children': []}
        while stack and stack[-1]['level'] >= level:
            stack.pop()
        (stack[-1]['children'] if stack else records).append(rec)
        stack.append(rec)
    return records


def _cv(rec: dict, tag: str) -> str:
    return next((c['value'] for c in rec['children'] if c['tag'] == tag), '')


def _cr(rec: dict, tag: str) -> dict | None:
    return next((c for c in rec['children'] if c['tag'] == tag), None)


@router.post("/gedcom/import")
async def import_gedcom(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    content = (await file.read()).decode('utf-8-sig', errors='replace')
    records = _parse_records(content)

    xref_map: dict[str, object] = {}
    persons_created = 0
    rels_created = 0

    for rec in records:
        if rec['tag'] != 'INDI' or not rec['xref']:
            continue
        name_val = _cv(rec, 'NAME')
        first_name, last_name = 'Unbekannt', 'Unbekannt'
        if name_val:
            parts = name_val.split('/')
            first_name = parts[0].strip() or 'Unbekannt'
            last_name = parts[1].strip() if len(parts) >= 2 else ''
            if not last_name:
                last_name, first_name = first_name, 'Unbekannt'

        sex = _cv(rec, 'SEX').upper()
        gender = {'M': 'male', 'F': 'female', 'U': 'other', 'X': 'other'}.get(sex)

        birt = _cr(rec, 'BIRT')
        deat = _cr(rec, 'DEAT')

        p = Person(
            first_name=first_name,
            last_name=last_name,
            gender=gender,
            date_of_birth=_from_ged_date(_cv(birt, 'DATE')) if birt else None,
            place_of_birth=(_cv(birt, 'PLAC') or None) if birt else None,
            date_of_death=_from_ged_date(_cv(deat, 'DATE')) if deat else None,
            place_of_death=(_cv(deat, 'PLAC') or None) if deat else None,
            is_living=deat is None,
        )
        db.add(p)
        await db.flush()
        xref_map[rec['xref']] = p.id
        persons_created += 1

    for rec in records:
        if rec['tag'] != 'FAM':
            continue
        husb = _strip_xref(_cv(rec, 'HUSB'))
        wife = _strip_xref(_cv(rec, 'WIFE'))
        children = [_strip_xref(c['value']) for c in rec['children'] if c['tag'] == 'CHIL']
        marr = _cr(rec, 'MARR')
        marr_date = _from_ged_date(_cv(marr, 'DATE')) if marr else None

        if husb and wife:
            a_id = xref_map.get(husb)
            b_id = xref_map.get(wife)
            if a_id and b_id:
                db.add(Relationship(
                    person_a_id=a_id, person_b_id=b_id,
                    type=RelationshipType.partner, start_date=marr_date,
                ))
                rels_created += 1

        for parent_xref in filter(None, [husb, wife]):
            parent_id = xref_map.get(parent_xref)
            if not parent_id:
                continue
            for child_xref in filter(None, children):
                child_id = xref_map.get(child_xref)
                if child_id:
                    db.add(Relationship(
                        person_a_id=parent_id, person_b_id=child_id,
                        type=RelationshipType.parent_child,
                    ))
                    rels_created += 1

    await db.commit()
    return {"persons_created": persons_created, "relationships_created": rels_created}


# ── JSON export ────────────────────────────────────────────────────────────────

@router.get("/export/json")
async def export_json(db: AsyncSession = Depends(get_db)):
    persons = (await db.execute(select(Person))).scalars().all()
    rels = (await db.execute(select(Relationship))).scalars().all()

    data = {
        "version": "1.0",
        "exported_at": datetime.utcnow().isoformat() + "Z",
        "persons": [
            {
                "id": str(p.id),
                "first_name": p.first_name,
                "last_name": p.last_name,
                "birth_name": p.birth_name,
                "gender": p.gender.value if p.gender else None,
                "date_of_birth": p.date_of_birth,
                "place_of_birth": p.place_of_birth,
                "date_of_death": p.date_of_death,
                "place_of_death": p.place_of_death,
                "is_living": p.is_living,
                "nationality": p.nationality,
                "origin": p.origin,
                "occupations": p.occupations,
                "biography": p.biography,
            }
            for p in persons
        ],
        "relationships": [
            {
                "id": str(r.id),
                "person_a_id": str(r.person_a_id),
                "person_b_id": str(r.person_b_id),
                "type": r.type.value,
                "start_date": r.start_date,
                "end_date": r.end_date,
                "end_reason": r.end_reason.value if r.end_reason else None,
                "notes": r.notes,
            }
            for r in rels
        ],
    }

    body = json.dumps(data, ensure_ascii=False, indent=2)
    return StreamingResponse(
        io.BytesIO(body.encode("utf-8")),
        media_type="application/json; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=stammbaum.json"},
    )


# ── JSON import ────────────────────────────────────────────────────────────────

@router.post("/import/json")
async def import_json(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    try:
        content = (await file.read()).decode("utf-8-sig")
        data = json.loads(content)
    except Exception:
        raise HTTPException(status_code=400, detail="Ungültige JSON-Datei")

    persons_list = data.get("persons", [])
    rels_list = data.get("relationships", [])

    id_map: dict[str, uuid.UUID] = {}
    persons_created = 0
    rels_created = 0

    for pd in persons_list:
        gender = None
        if pd.get("gender"):
            try:
                gender = GenderEnum(pd["gender"])
            except ValueError:
                pass

        p = Person(
            first_name=pd.get("first_name") or "Unbekannt",
            last_name=pd.get("last_name") or "Unbekannt",
            birth_name=pd.get("birth_name"),
            gender=gender,
            date_of_birth=pd.get("date_of_birth"),
            place_of_birth=pd.get("place_of_birth"),
            date_of_death=pd.get("date_of_death"),
            place_of_death=pd.get("place_of_death"),
            is_living=pd.get("is_living", True),
            nationality=pd.get("nationality"),
            origin=pd.get("origin"),
            occupations=pd.get("occupations"),
            biography=pd.get("biography"),
        )
        db.add(p)
        await db.flush()
        if pd.get("id"):
            id_map[pd["id"]] = p.id
        persons_created += 1

    for rd in rels_list:
        a_id = id_map.get(rd.get("person_a_id", ""))
        b_id = id_map.get(rd.get("person_b_id", ""))
        if not a_id or not b_id:
            continue
        try:
            rel_type = RelationshipType(rd["type"])
        except (KeyError, ValueError):
            continue
        db.add(Relationship(
            person_a_id=a_id,
            person_b_id=b_id,
            type=rel_type,
            start_date=rd.get("start_date"),
            end_date=rd.get("end_date"),
            notes=rd.get("notes"),
        ))
        rels_created += 1

    await db.commit()
    return {"persons_created": persons_created, "relationships_created": rels_created}
