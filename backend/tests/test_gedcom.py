"""Tests for GEDCOM export/import and JSON export/import."""
import io
import json
import uuid

import pytest


async def _seed(client):
    """Create two persons and a partner relationship, return (pa, pb, rel)."""
    pa = (await client.post("/api/v1/persons", json={
        "first_name": "Johann", "last_name": "Bach",
        "gender": "male", "date_of_birth": "1685-03-21",
        "date_of_death": "1750-07-28", "place_of_birth": "Eisenach",
        "is_living": False, "biography": "Composer.",
        "sources": ["Grove Music Encyclopedia"],
    })).json()
    pb = (await client.post("/api/v1/persons", json={
        "first_name": "Maria", "last_name": "Bach",
        "gender": "female", "date_of_birth": "1684-01-01",
        "is_living": True,
    })).json()
    rel = (await client.post("/api/v1/relationships", json={
        "person_a_id": pa["id"], "person_b_id": pb["id"],
        "type": "partner", "start_date": "1707-10-17",
    })).json()
    return pa, pb, rel


# ── GEDCOM export ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_gedcom_export_contains_names(async_client):
    await _seed(async_client)
    r = await async_client.get("/api/v1/gedcom/export")
    assert r.status_code == 200
    body = r.text
    assert "Johann" in body
    assert "Bach" in body
    assert "INDI" in body
    assert "FAM" in body


@pytest.mark.asyncio
async def test_gedcom_export_dates(async_client):
    await _seed(async_client)
    r = await async_client.get("/api/v1/gedcom/export")
    body = r.text
    # 1685-03-21 → "21 MAR 1685"
    assert "21 MAR 1685" in body
    assert "28 JUL 1750" in body


@pytest.mark.asyncio
async def test_gedcom_export_anonymize_living(async_client):
    await _seed(async_client)
    r = await async_client.get("/api/v1/gedcom/export?anonymize_living=true")
    assert r.status_code == 200
    body = r.text
    # Living person Maria Bach must be redacted
    assert "Maria" not in body
    assert "Lebende" in body
    assert "PRIVACY" in body
    # Deceased person Johann Bach must still be present
    assert "Johann" in body


@pytest.mark.asyncio
async def test_gedcom_export_empty_db(async_client):
    r = await async_client.get("/api/v1/gedcom/export")
    assert r.status_code == 200
    assert "HEAD" in r.text
    assert "TRLR" in r.text


# ── GEDCOM import ─────────────────────────────────────────────────────────────

MINIMAL_GEDCOM = """\
0 HEAD
1 GEDC
2 VERS 5.5.1
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Clara /Schumann/
1 SEX F
1 BIRT
2 DATE 13 SEP 1819
2 PLAC Zwickau
1 DEAT Y
2 DATE 20 MAY 1896
0 @I2@ INDI
1 NAME Robert /Schumann/
1 SEX M
1 BIRT
2 DATE 8 JUN 1810
0 @F1@ FAM
1 HUSB @I2@
1 WIFE @I1@
1 MARR
2 DATE 12 SEP 1840
0 TRLR
"""


@pytest.mark.asyncio
async def test_gedcom_import_creates_persons(async_client):
    r = await async_client.post(
        "/api/v1/gedcom/import",
        files={"file": ("test.ged", MINIMAL_GEDCOM.encode(), "text/plain")},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["persons_created"] == 2
    assert body["relationships_created"] >= 1

    persons = (await async_client.get("/api/v1/persons")).json()
    names = {p["first_name"] for p in persons}
    assert "Clara" in names
    assert "Robert" in names


@pytest.mark.asyncio
async def test_gedcom_import_date_conversion(async_client):
    await async_client.post(
        "/api/v1/gedcom/import",
        files={"file": ("test.ged", MINIMAL_GEDCOM.encode(), "text/plain")},
    )
    persons = (await async_client.get("/api/v1/persons")).json()
    clara = next(p for p in persons if p["first_name"] == "Clara")
    assert clara["date_of_birth"] == "1819-09-13"
    assert clara["place_of_birth"] == "Zwickau"


@pytest.mark.asyncio
async def test_gedcom_import_additive(async_client):
    """Re-importing GEDCOM creates duplicates (no UUID-based dedup)."""
    for _ in range(2):
        await async_client.post(
            "/api/v1/gedcom/import",
            files={"file": ("test.ged", MINIMAL_GEDCOM.encode(), "text/plain")},
        )
    persons = (await async_client.get("/api/v1/persons")).json()
    assert len(persons) == 4  # 2 persons × 2 imports


# ── JSON export ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_json_export_structure(async_client):
    pa, pb, rel = await _seed(async_client)
    r = await async_client.get("/api/v1/export/json")
    assert r.status_code == 200
    data = r.json()
    assert data["version"] == "1.0"
    assert len(data["persons"]) == 2
    assert len(data["relationships"]) == 1


@pytest.mark.asyncio
async def test_json_export_anonymize_living(async_client):
    await _seed(async_client)
    r = await async_client.get("/api/v1/export/json?anonymize_living=true")
    data = r.json()
    living_entries = [p for p in data["persons"] if p.get("is_living")]
    for entry in living_entries:
        assert "first_name" not in entry


@pytest.mark.asyncio
async def test_json_export_includes_sources(async_client):
    await _seed(async_client)
    r = await async_client.get("/api/v1/export/json")
    data = r.json()
    persons = {p["first_name"]: p for p in data["persons"]}
    assert persons["Johann"].get("sources") == ["Grove Music Encyclopedia"]


# ── JSON import ────────────────────────────────────────────────────────────────

def _make_json_payload(n_persons=2, include_rel=True) -> bytes:
    ids = [str(uuid.uuid4()) for _ in range(n_persons)]
    persons = [
        {"id": ids[0], "first_name": "Test", "last_name": "Alpha", "is_living": False},
        {"id": ids[1], "first_name": "Test", "last_name": "Beta",  "is_living": True},
    ]
    rels = []
    if include_rel and n_persons >= 2:
        rels = [{"id": str(uuid.uuid4()), "person_a_id": ids[0], "person_b_id": ids[1], "type": "partner"}]
    return json.dumps({
        "version": "1.0",
        "exported_at": "2024-01-01T00:00:00Z",
        "persons": persons[:n_persons],
        "relationships": rels,
    }).encode()


@pytest.mark.asyncio
async def test_json_import_creates_records(async_client):
    r = await async_client.post(
        "/api/v1/import/json",
        files={"file": ("backup.json", _make_json_payload(), "application/json")},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["persons_created"] == 2
    assert body["relationships_created"] == 1
    assert body["persons_skipped"] == 0


@pytest.mark.asyncio
async def test_json_import_idempotent(async_client):
    """Re-importing the same JSON backup must not create duplicates."""
    payload = _make_json_payload()
    await async_client.post("/api/v1/import/json",
        files={"file": ("backup.json", payload, "application/json")})

    # Second import
    r = await async_client.post("/api/v1/import/json",
        files={"file": ("backup.json", payload, "application/json")})
    body = r.json()
    assert body["persons_created"] == 0
    assert body["persons_skipped"] == 2
    assert body["relationships_skipped"] == 1

    # Total persons must still be 2
    persons = (await async_client.get("/api/v1/persons")).json()
    assert len(persons) == 2


@pytest.mark.asyncio
async def test_json_import_invalid_file(async_client):
    r = await async_client.post(
        "/api/v1/import/json",
        files={"file": ("bad.json", b"not json at all", "application/json")},
    )
    assert r.status_code == 400
