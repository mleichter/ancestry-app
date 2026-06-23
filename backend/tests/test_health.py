import pytest


@pytest.mark.asyncio
async def test_health_returns_ok(async_client):
    r = await async_client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "db" in body


@pytest.mark.asyncio
async def test_health_db_connected(async_client):
    r = await async_client.get("/health")
    assert r.json()["db"] == "connected"
