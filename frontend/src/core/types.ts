export type ModuleSlot = "today_view" | "work_dashboard" | "dashboard_view" | "health_view";

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
}

export type SettingsFieldType = "string" | "password" | "boolean" | "select";

export interface SettingsField {
  key: string;
  label: string;
  type: SettingsFieldType;
  required: boolean;
  help_text?: string | null;
  default?: unknown;
  options?: { label: string; value: string }[];
}

export interface SettingsModuleSchema {
  module_id: string;
  module_name: string;
  fields: SettingsField[];
}

export type SettingsValueMap = Record<string, Record<string, unknown>>;
