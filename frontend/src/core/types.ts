export type ModuleSlot = "today_view" | "work_dashboard" | "health_view";

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
  HealthWidget?: React.ComponentType;
}
