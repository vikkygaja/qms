from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, read from environment variables (or .env in development)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "production"  # only "development" enables API docs
    database_url: SecretStr  # required; never logged
    redis_url: str = "redis://redis:6379/0"
    app_version: str = "0.1.0"

    @property
    def docs_enabled(self) -> bool:
        return self.env == "development"


@lru_cache
def get_settings() -> Settings:
    return Settings()
