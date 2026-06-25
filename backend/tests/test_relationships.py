import pytest


async def _two_persons(client):
    pa = (await client.post("/api/v1/persons", json={"first_name": "Alice", "last_name": "A"})).json()
    pb = (await client.post("/api/v1/persons", json={"first_name": "Bob", "last_name": "B"})).json()
    return pa["id"], pb["id"]


@pytest.mark.asyncio
async def test_list_relationships_empty(async_client):
    r = await async_client.get("/api/v1/relationships")
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_create_partner_relationship(async_client):
    aid, bid = await _two_persons(async_client)
    r = await async_client.post("/api/v1/relationships", json={
        "person_a_id": aid,
        "person_b_id": bid,
        "type": "partner",
        "start_date": "1975-06-01",
    })
    assert r.status_code == 201
    body = r.json()
    assert body["type"] == "partner"
    assert body["start_date"] == "1975-06-01"
    assert body["person_a_id"] == aid


@pytest.mark.asyncio
async def test_create_parent_child_relationship(async_client):
    parent_id, child_id = await _two_persons(async_client)
    r = await async_client.post("/api/v1/relationships", json={
        "person_a_id": parent_id,
        "person_b_id": child_id,
        "type": "parent_child",
    })
    assert r.status_code == 201
    assert r.json()["type"] == "parent_child"


@pytest.mark.asyncio
async def test_get_relationship(async_client):
    aid, bid = await _two_persons(async_client)
    create = await async_client.post("/api/v1/relationships", json={
        "person_a_id": aid, "person_b_id": bid, "type": "partner"
    })
    rid = create.json()["id"]
    r = await async_client.get(f"/api/v1/relationships/{rid}")
    assert r.status_code == 200
    assert r.json()["id"] == rid


@pytest.mark.asyncio
async def test_get_relationship_not_found(async_client):
    r = await async_client.get("/api/v1/relationships/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_update_relationship(async_client):
    aid, bid = await _two_persons(async_client)
    create = await async_client.post("/api/v1/relationships", json={
        "person_a_id": aid, "person_b_id": bid, "type": "partner"
    })
    rid = create.json()["id"]
    r = await async_client.patch(f"/api/v1/relationships/{rid}", json={
        "end_date": "2000-01-01", "end_reason": "divorce"
    })
    assert r.status_code == 200
    body = r.json()
    assert body["end_date"] == "2000-01-01"
    assert body["end_reason"] == "divorce"


@pytest.mark.asyncio
async def test_delete_relationship(async_client):
    aid, bid = await _two_persons(async_client)
    create = await async_client.post("/api/v1/relationships", json={
        "person_a_id": aid, "person_b_id": bid, "type": "partner"
    })
    rid = create.json()["id"]
    r = await async_client.delete(f"/api/v1/relationships/{rid}")
    assert r.status_code == 204
    r2 = await async_client.get(f"/api/v1/relationships/{rid}")
    assert r2.status_code == 404


@pytest.mark.asyncio
async def test_filter_relationships_by_person(async_client):
    aid, bid = await _two_persons(async_client)
    pc = (await async_client.post("/api/v1/persons", json={"first_name": "C", "last_name": "C"})).json()

    await async_client.post("/api/v1/relationships", json={
        "person_a_id": aid, "person_b_id": bid, "type": "partner"
    })
    await async_client.post("/api/v1/relationships", json={
        "person_a_id": aid, "person_b_id": pc["id"], "type": "parent_child"
    })

    r = await async_client.get(f"/api/v1/relationships?person_id={aid}")
    assert len(r.json()) == 2

    r2 = await async_client.get(f"/api/v1/relationships?person_id={bid}")
    assert len(r2.json()) == 1


@pytest.mark.asyncio
async def test_create_relationship_invalid_person_rejected(async_client):
    """Creating a relationship with a non-existent person should return 404."""
    fake_id = "00000000-0000-0000-0000-000000000000"
    r = await async_client.post("/api/v1/relationships", json={
        "person_a_id": fake_id,
        "person_b_id": fake_id,
        "type": "partner",
    })
    assert r.status_code == 404
