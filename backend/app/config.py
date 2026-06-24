from functools import lru_cache
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str
    media_storage_path: str = "/data/media"
    max_upload_size_mb: int = 20
    openai_api_key: Optional[str] = None
    openai_base_url: Optional[str] = None  # e.g. http://litellm:4000

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
