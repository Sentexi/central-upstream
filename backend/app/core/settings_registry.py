"""Automatic discovery of module settings providers."""

import importlib
import pkgutil
from typing import List, Optional

from .settings_provider import ModuleSettingsProvider

registered_settings_providers: List[ModuleSettingsProvider] = []


def discover_settings_providers():
    """Find settings providers exposed by installed modules."""
    registered_settings_providers.clear()
    from app import modules  # type: ignore

    for _finder, name, _ispkg in pkgutil.iter_modules(
        modules.__path__, modules.__name__ + "."
    ):
        try:
            mod = importlib.import_module(name + ".settings")
        except ModuleNotFoundError:
            continue

        provider = getattr(mod, "settings_provider", None)

        if isinstance(provider, ModuleSettingsProvider):
            registered_settings_providers.append(provider)


def get_provider(module_id: str) -> Optional[ModuleSettingsProvider]:
    """Return the provider for a module if it exists."""
    for provider in registered_settings_providers:
        if provider.module_id == module_id:
            return provider
    return None


def get_all_providers() -> List[ModuleSettingsProvider]:
    return list(registered_settings_providers)
