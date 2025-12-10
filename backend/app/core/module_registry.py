import importlib
import pkgutil
from typing import List
from .module_base import BaseModule

registered_modules: List[BaseModule] = []

def discover_modules():
    """
    Findet interne Module unter app.modules.* automatisch.

    Erwartung:
    - Jedes Modul liegt unter app/modules/<name>/
    - Es gibt eine module.py mit einer Variable "module",
      die eine Instanz von BaseModule enthält.
    """
    from app import modules  # type: ignore

    for finder, name, ispkg in pkgutil.iter_modules(modules.__path__, modules.__name__ + "."):
        # In jedem Modul-Paket versuchen wir module.py zu importieren
        try:
            mod = importlib.import_module(name + ".module")
        except ModuleNotFoundError:
            continue

        candidate = getattr(mod, "module", None)
        if isinstance(candidate, BaseModule):
            registered_modules.append(candidate)

def init_all_modules(app):
    """Ruft init_app() für alle registrierten Module auf."""
    for m in registered_modules:
        m.init_app(app)

def get_manifests():
    """Liefert die Manifeste aller Module."""
    return [m.get_manifest() for m in registered_modules]
