import { useMemo, useState } from "react";
import { SegmentedControl } from "../../core/ui";
import type { SegmentedControlOption } from "../../core/ui";
import { FitnessDashboardView } from "./FitnessDashboardView";
import { WorkoutOverviewView } from "./WorkoutOverviewView";

type FitnessMode = "fitness" | "workouts";

const MODE_OPTIONS = [
  { value: "fitness", label: "Fitness" },
  { value: "workouts", label: "Workouts" },
] satisfies SegmentedControlOption[];

export function FitnessModuleView() {
  const [mode, setMode] = useState<FitnessMode>("fitness");
  const navigation = useMemo(
    () => (
      <SegmentedControl
        options={MODE_OPTIONS}
        value={mode}
        onChange={(value) => setMode(value as FitnessMode)}
      />
    ),
    [mode],
  );

  if (mode === "workouts") {
    return <WorkoutOverviewView navigation={navigation} />;
  }
  return <FitnessDashboardView navigation={navigation} />;
}
