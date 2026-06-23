"""
E2E tests run against the live Docker stack.
Set BASE_URL env var to override the default (http://localhost:80).
"""
import os
import pytest

BASE_URL = os.environ.get("E2E_BASE_URL", "http://localhost:80")
API_URL = f"{BASE_URL}/api/v1"


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def api_url():
    return API_URL
