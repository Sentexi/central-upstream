from abc import ABC, abstractmethod
from typing import Any, Dict, List, Tuple


SettingsField = Dict[str, Any]
SettingsStatus = Dict[str, Any]
SettingsManualImport = Dict[str, Any]


class ModuleSettingsProvider(ABC):
    """Interface that modules implement to expose settings and validation."""

    module_id: str
    module_name: str

    @abstractmethod
    def get_settings_schema(self) -> List[SettingsField]:
        """Return a declarative schema describing required settings fields."""
        raise NotImplementedError

    @abstractmethod
    def validate_settings(self, settings: Dict[str, Any]) -> Tuple[bool, str | None]:
        """Validate settings by performing live checks (e.g. API calls)."""
        raise NotImplementedError

    def get_status_metadata(self) -> SettingsStatus | None:
        """Optional status metadata to display status information in the UI."""
        return None

    def get_manual_import_metadata(self) -> SettingsManualImport | None:
        """Optional metadata to drive manual import (e.g. file upload) in the UI."""
        return None
