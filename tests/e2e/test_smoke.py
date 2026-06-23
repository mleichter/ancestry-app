"""
Smoke tests run against the live Docker stack after deployment.
They verify the golden path without relying on specific DB state.
"""
import pytest
import httpx
from playwright.sync_api import sync_playwright, expect


# ── API health checks ─────────────────────────────────────────────────────────

def test_health_endpoint(api_url):
    r = httpx.get(f"{api_url.replace('/api/v1', '')}/health", timeout=10)
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_api_persons_list(api_url):
    r = httpx.get(f"{api_url}/persons", timeout=10)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_api_relationships_list(api_url):
    r = httpx.get(f"{api_url}/relationships", timeout=10)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_openapi_docs_accessible(base_url):
    r = httpx.get(f"{base_url}/docs", timeout=10)
    assert r.status_code == 200
    assert "swagger" in r.text.lower() or "openapi" in r.text.lower()


# ── CRUD person lifecycle via API ─────────────────────────────────────────────

def test_person_crud_lifecycle(api_url):
    """Create → read → update → delete a person via the API."""
    # Create
    r = httpx.post(f"{api_url}/persons", json={
        "first_name": "E2E", "last_name": "TestPerson",
        "date_of_birth": "2000-01-01", "is_living": True,
    }, timeout=10)
    assert r.status_code == 201
    pid = r.json()["id"]

    # Read
    r = httpx.get(f"{api_url}/persons/{pid}", timeout=10)
    assert r.status_code == 200
    assert r.json()["first_name"] == "E2E"

    # Update
    r = httpx.patch(f"{api_url}/persons/{pid}", json={"nationality": "German"}, timeout=10)
    assert r.status_code == 200
    assert r.json()["nationality"] == "German"

    # Delete
    r = httpx.delete(f"{api_url}/persons/{pid}", timeout=10)
    assert r.status_code == 204

    # Verify gone
    r = httpx.get(f"{api_url}/persons/{pid}", timeout=10)
    assert r.status_code == 404


def test_relationship_cascade_delete(api_url):
    """Deleting a person must cascade-delete their relationships."""
    pa = httpx.post(f"{api_url}/persons", json={"first_name": "E2E-A", "last_name": "Cascade"}, timeout=10).json()
    pb = httpx.post(f"{api_url}/persons", json={"first_name": "E2E-B", "last_name": "Cascade"}, timeout=10).json()
    rel = httpx.post(f"{api_url}/relationships", json={
        "person_a_id": pa["id"], "person_b_id": pb["id"], "type": "partner"
    }, timeout=10).json()

    # Delete person A
    httpx.delete(f"{api_url}/persons/{pa['id']}", timeout=10)

    # Relationship must be gone
    r = httpx.get(f"{api_url}/relationships/{rel['id']}", timeout=10)
    assert r.status_code == 404

    # Cleanup
    httpx.delete(f"{api_url}/persons/{pb['id']}", timeout=10)


# ── Browser UI smoke tests ────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def browser_page(base_url):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(base_url, wait_until="networkidle")
        yield page
        browser.close()


def test_ui_loads(browser_page):
    """App loads and shows the Stammbaum nav."""
    assert "Stammbaum" in browser_page.title() or browser_page.locator("text=Stammbaum").count() > 0


def test_ui_nav_links(browser_page):
    """All primary nav links are present."""
    nav = browser_page.locator("nav")
    for label in ["Personen", "Stammbaum", "Suche", "Einstellungen"]:
        expect(nav.locator(f"text={label}")).to_be_visible()


def test_ui_persons_page(base_url):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(f"{base_url}/persons", wait_until="networkidle")
        # Page loaded (either empty state or list)
        page.wait_for_timeout(500)
        assert page.url.endswith("/persons")
        browser.close()


def test_ui_settings_page(base_url):
    """Settings page loads and shows version info."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(f"{base_url}/settings", wait_until="networkidle")
        page.wait_for_timeout(500)
        # Should show version number somewhere on the page
        content = page.content()
        assert "1.0" in content or "version" in content.lower()
        browser.close()
