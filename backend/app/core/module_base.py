from abc import ABC, abstractmethod

class BaseModule(ABC):
    """
    Basisklasse für alle Module.

    Ein Modul ist dann gültig, wenn es:
    - eine eindeutige id hat
    - einen Namen
    - init_app implementiert
    """

    id: str
    name: str
    version: str = "0.1.0"

    @abstractmethod
    def init_app(self, app):
        """Blueprints registrieren, ggf. DB initialisieren."""
        raise NotImplementedError

    def get_manifest(self) -> dict:
        """Metadaten für Frontend & Settings."""
        return {
            "id": self.id,
            "name": self.name,
            "version": self.version,
            "slots": [],
            "ready": self.check_ready(),
        }

    def check_ready(self) -> bool:
        """Ist das Modul einsatzbereit? (Tokens, Migrationen etc.)"""
        return True
