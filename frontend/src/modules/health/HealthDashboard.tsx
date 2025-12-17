import { EnergyMonitorWidget } from "./EnergyMonitorWidget";
import { FitnessOverview } from "./FitnessOverview";
import "./health.css";

export function HealthDashboard() {
  return (
    <div className="health-grid" role="list">
      <div role="listitem">
        <EnergyMonitorWidget />
      </div>
      <div role="listitem">
        <FitnessOverview />
      </div>
    </div>
  );
}
