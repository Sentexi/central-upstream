export type ModuleSlot =
  | "today_view"
  | "work_dashboard"
  | "dashboard_view"
  | "health_view"
  | "fitness_view"
  | "calories_view"
  | "vape_tracker_view";

export interface ModuleManifest {
  id: string;
  name: string;
  version: string;
  slots: ModuleSlot[];
  ready: boolean;
}

export interface ModuleFrontend {
  id: string;
  slots: ModuleSlot[];
  TodayWidget?: React.ComponentType;
  WorkWidget?: React.ComponentType;
  DashboardWidget?: React.ComponentType;
  HealthWidget?: React.ComponentType;
  FitnessWidget?: React.ComponentType;
  CaloriesWidget?: React.ComponentType;
  VapeTrackerWidget?: React.ComponentType;
}

export type SettingsFieldType = "string" | "password" | "boolean" | "select" | "file";

export interface SettingsField {
  key: string;
  label: string;
  type: SettingsFieldType;
  required: boolean;
  help_text?: string | null;
  default?: unknown;
  options?: { label: string; value: string }[];
  read_only?: boolean;
  accept?: string[];
}

export interface SettingsStatusMetadata {
  endpoint: string;
  label?: string;
  value_key?: string;
  formatter?: "datetime";
  stage_labels?: Record<string, string>;
  upload_hint?: string;
}

export interface SettingsManualImportMetadata {
  endpoint: string;
  label: string;
  help_text?: string | null;
  accept?: string[];
  upload_kind?: "json" | "file";
  success_message?: string;
  error_message?: string;
  method?: string;
}

export interface SettingsModuleSchema {
  module_id: string;
  module_name: string;
  fields: SettingsField[];
  status?: SettingsStatusMetadata | null;
  manual_import?: SettingsManualImportMetadata | null;
}

export type SettingsValueMap = Record<string, Record<string, unknown>>;
