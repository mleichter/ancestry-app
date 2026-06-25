import pytest


PERSON_A = {"first_name": "Anna", "last_name": "Müller", "date_of_birth": "1950-03-15", "is_living": False}
PERSON_B = {"first_name": "Hans", "last_name": "Müller", "date_of_birth": "1948-07-22", "is_living": False}


# ── CRUD ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_persons_empty(async_client):
    r = await async_client.get("/api/v1/persons")
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_create_person_minimal(async_client):
    r = await async_client.post("/api/v1/persons", json={"first_name": "Ada", "last_name": "Lovelace"})
    assert r.status_code == 201
    body = r.json()
    assert body["first_name"] == "Ada"
    assert body["last_name"] == "Lovelace"
    assert "id" in body
    assert "created_at" in body


@pytest.mark.asyncio
async def test_create_person_full(async_client):
    payload = {
        "first_name": "Marie",
        "last_name": "Curie",
        "birth_name": "Skłodowska",
        "gender": "female",
        "date_of_birth": "1867-11-07",
        "place_of_birth": "Warsaw",
        "date_of_death": "1934-07-04",
        "place_of_death": "Passy",
        "is_living": False,
        "nationality": "French",
        "occupations": ["physicist", "chemist"],
        "sources": ["Wikipedia", "Nobel Prize records"],
        "biography": "First woman to win a Nobel Prize.",
    }
    r = await async_client.post("/api/v1/persons", json=payload)
    assert r.status_code == 201
    body = r.json()
    assert body["occupations"] == ["physicist", "chemist"]
    assert body["sources"] == ["Wikipedia", "Nobel Prize records"]
    assert body["birth_name"] == "Skłodowska"


@pytest.mark.asyncio
async def test_get_person(async_client):
    create = await async_client.post("/api/v1/persons", json=PERSON_A)
    pid = create.json()["id"]
    r = await async_client.get(f"/api/v1/persons/{pid}")
    assert r.status_code == 200
    assert r.json()["first_name"] == "Anna"


@pytest.mark.asyncio
async def test_get_person_not_found(async_client):
    r = await async_client.get("/api/v1/persons/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_update_person(async_client):
    create = await async_client.post("/api/v1/persons", json=PERSON_A)
    pid = create.json()["id"]
    r = await async_client.patch(f"/api/v1/persons/{pid}", json={"nationality": "German"})
    assert r.status_code == 200
    assert r.json()["nationality"] == "German"
    assert r.json()["first_name"] == "Anna"  # unchanged


@pytest.mark.asyncio
async def test_update_sources(async_client):
    create = await async_client.post("/api/v1/persons", json=PERSON_A)
    pid = create.json()["id"]
    r = await async_client.patch(f"/api/v1/persons/{pid}", json={"sources": ["Church record 1850"]})
    assert r.status_code == 200
    assert r.json()["sources"] == ["Church record 1850"]


@pytest.mark.asyncio
async def test_delete_person(async_client):
    create = await async_client.post("/api/v1/persons", json=PERSON_A)
    pid = create.json()["id"]
    r = await async_client.delete(f"/api/v1/persons/{pid}")
    assert r.status_code == 204
    r2 = await async_client.get(f"/api/v1/persons/{pid}")
    assert r2.status_code == 404


@pytest.mark.asyncio
async def test_delete_person_cascades_relationships(async_client):
    """Deleting a person must also delete their relationships (CASCADE at DB level)."""
    pa = (await async_client.post("/api/v1/persons", json=PERSON_A)).json()
    pb = (await async_client.post("/api/v1/persons", json=PERSON_B)).json()
    rel = (await async_client.post("/api/v1/relationships", json={
        "person_a_id": pa["id"],
        "person_b_id": pb["id"],
        "type": "partner",
    })).json()

    await async_client.delete(f"/api/v1/persons/{pa['id']}")

    # relationship must be gone
    r = await async_client.get(f"/api/v1/relationships/{rel['id']}")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_list_persons_returns_all(async_client):
    await async_client.post("/api/v1/persons", json=PERSON_A)
    await async_client.post("/api/v1/persons", json=PERSON_B)
    r = await async_client.get("/api/v1/persons")
    assert len(r.json()) == 2


@pytest.mark.asyncio
async def test_list_persons_limit(async_client):
    for i in range(5):
        await async_client.post("/api/v1/persons", json={"first_name": f"P{i}", "last_name": "Test"})
    r = await async_client.get("/api/v1/persons?limit=3")
    assert len(r.json()) == 3


@pytest.mark.asyncio
async def test_create_person_empty_first_name_rejected(async_client):
    r = await async_client.post("/api/v1/persons", json={"first_name": "", "last_name": "Müller"})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_person_name_too_long_rejected(async_client):
    r = await async_client.post("/api/v1/persons", json={"first_name": "A" * 101, "last_name": "B"})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_list_persons_limit_cap(async_client):
    """limit > 1000 should be rejected with 422."""
    r = await async_client.get("/api/v1/persons?limit=9999")
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_list_persons_negative_skip_rejected(async_client):
    r = await async_client.get("/api/v1/persons?skip=-1")
    assert r.status_code == 422
