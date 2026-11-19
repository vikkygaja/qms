from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, read from environment variables (or .env in development)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "production"  # only "development" enables API docs
    # Owner connection: migrations and provisioning only (a superuser bypasses row-level security).
    database_url: SecretStr
    # Runtime connection as the non-superuser role `qms_app`; falls back to database_url.
    app_database_url: SecretStr | None = None
    redis_url: str = "redis://redis:6379/0"
    app_version: str = "0.1.0"

    # Sessions and cookies
    cookie_secure: bool = True  # false only while the server has no HTTPS (see decisions 33)
    session_idle_minutes: int = 30
    session_absolute_hours: int = 12
    lockout_attempts: int = 5
    lockout_minutes: int = 15

    # Tenancy (pilot: one hospital; hostname-based resolution comes later)
    default_tenant_code: str = "SNHRC"
    default_tenant_name: str = "Sri Narayani Hospital & Research Centre"

    # Password hashing (argon2id). Tests lower these for speed.
    argon2_time_cost: int = 3
    argon2_memory_cost: int = 65536
    argon2_parallelism: int = 4

    @property
    def docs_enabled(self) -> bool:
        return self.env == "development"

    @property
    def runtime_database_url(self) -> str:
        return (self.app_database_url or self.database_url).get_secret_value()


@lru_cache
def get_settings() -> Settings:
    return Settings()
