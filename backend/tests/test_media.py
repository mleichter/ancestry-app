"""Tests for media listing pagination."""
import io
import pytest


PERSON = {"first_name": "Foto", "last_name": "Test"}

# Minimal valid JPEG: SOI + APP0 marker + EOI
JPEG_BYTES = b"\xff\xd8\xff\xe0" + b"\x00" * 10 + b"\xff\xd9"


@pytest.mark.asyncio
async def test_list_person_media_empty(async_client):
    person = (await async_client.post("/api/v1/persons", json=PERSON)).json()
    r = await async_client.get(f"/api/v1/persons/{person['id']}/media")
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_list_person_media_default_limit(async_client):
    """Endpoint accepts skip and limit query params."""
    person = (await async_client.post("/api/v1/persons", json=PERSON)).json()
    pid = person["id"]

    for i in range(3):
        img = io.BytesIO(JPEG_BYTES)
        await async_client.post(
            f"/api/v1/persons/{pid}/media",
            files={"file": (f"photo{i}.jpg", img, "image/jpeg")},
        )

    r = await async_client.get(f"/api/v1/persons/{pid}/media")
    assert r.status_code == 200
    assert len(r.json()) == 3

    r2 = await async_client.get(f"/api/v1/persons/{pid}/media?limit=2")
    assert r2.status_code == 200
    assert len(r2.json()) == 2

    r3 = await async_client.get(f"/api/v1/persons/{pid}/media?skip=2")
    assert r3.status_code == 200
    assert len(r3.json()) == 1


@pytest.mark.asyncio
async def test_list_person_media_limit_cap(async_client):
    """limit > 500 is rejected."""
    person = (await async_client.post("/api/v1/persons", json=PERSON)).json()
    r = await async_client.get(f"/api/v1/persons/{person['id']}/media?limit=9999")
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_list_person_media_negative_skip_rejected(async_client):
    person = (await async_client.post("/api/v1/persons", json=PERSON)).json()
    r = await async_client.get(f"/api/v1/persons/{person['id']}/media?skip=-1")
    assert r.status_code == 422
