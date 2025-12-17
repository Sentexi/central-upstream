import type { FitnessPayload } from "./types";

export async function fetchFitness(range: string, group: string): Promise<FitnessPayload> {
  const params = new URLSearchParams({ range, group });
  const res = await fetch(`/api/health/fitness?${params.toString()}`);
  if (!res.ok) {
    throw new Error("Fitness-Daten konnten nicht geladen werden");
  }
  return res.json();
}
