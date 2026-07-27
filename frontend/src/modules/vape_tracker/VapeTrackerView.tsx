import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Check, RotateCcw } from "lucide-react";

import { BarChart, CHART_COLORS } from "../../core/charts";
import {
  Badge,
  Button,
  Card,
  PageHeader,
  SectionHeader,
  SegmentedControl,
} from "../../core/ui";
import {
  fetchVapeOverview,
  saveCoilChange,
  saveVapeCounter,
} from "./api";
import type {
  VapeEntry,
  VapeGranularity,
  VapeOverview,
  VapeRange,
} from "./api";


const GRANULARITY_OPTIONS = [
  { value: "day", label: "Tage" },
  { value: "week", label: "Wochen" },
  { value: "month", label: "Monate" },
];

const RANGE_OPTIONS: Record<VapeGranularity, Array<{ value: VapeRange; label: string }>> = {
  day: [
    { value: "14d", label: "14 Tage" },
    { value: "30d", label: "30 Tage" },
    { value: "90d", label: "90 Tage" },
  ],
  week: [
    { value: "30d", label: "30 Tage" },
    { value: "90d", label: "90 Tage" },
    { value: "6m", label: "6 Monate" },
  ],
  month: [
    { value: "6m", label: "6 Monate" },
    { value: "12m", label: "12 Monate" },
  ],
};

const DEFAULT_RANGE: Record<VapeGranularity, VapeRange> = {
  day: "30d",
  week: "90d",
  month: "12m",
};

const numberFormat = new Intl.NumberFormat("de-DE", {
  maximumFractionDigits: 1,
});
const dateFormat = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
});
const dateTimeFormat = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function formatDate(value: string): string {
  return dateFormat.format(new Date(`${value}T12:00:00`));
}

function formatDateTime(value: string): string {
  return dateTimeFormat.format(new Date(value));
}

function parseCounter(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="vape-tracker__metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

function entryLabel(entry: VapeEntry): string {
  if (entry.event_type === "coil_change") return "Counter auf 0 gesetzt";
  if (entry.note?.startsWith("final_before_coil_change")) {
    return `Endstand vor Coil Wechsel: ${entry.counter}`;
  }
  return `Counter ${entry.counter}`;
}

export function VapeTrackerView() {
  const [counter, setCounter] = useState("");
  const [granularity, setGranularity] = useState<VapeGranularity>("day");
  const [range, setRange] = useState<VapeRange>("30d");
  const [overview, setOverview] = useState<VapeOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  const validCounter = parseCounter(counter);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchVapeOverview(granularity, range)
      .then((data) => {
        if (active) setOverview(data);
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : "Auswertung konnte nicht geladen werden.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [granularity, range]);

  const refresh = async () => {
    setOverview(await fetchVapeOverview(granularity, range));
  };

  const submit = async (kind: "reading" | "coil_change") => {
    if (validCounter === null) {
      setError("Trage einen nicht negativen, ganzen Counterstand ein.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setConfirmation(null);
    try {
      if (kind === "coil_change") {
        await saveCoilChange(validCounter);
        setConfirmation(`Endstand ${validCounter} gespeichert. Der neue Counter startet bei 0.`);
      } else {
        await saveVapeCounter(validCounter);
        setConfirmation(`Counter ${validCounter} wurde gespeichert.`);
      }
      setCounter("");
      await refresh();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Eintrag konnte nicht gespeichert werden.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit("reading");
  };

  const chartData = useMemo(
    () =>
      (overview?.buckets ?? [])
        .filter((bucket) => bucket.observed_days > 0)
        .map((bucket) => ({
          period: bucket.period_start,
          value:
            granularity === "day"
              ? bucket.total_puffs
              : Number(bucket.average_per_day.toFixed(1)),
        })),
    [granularity, overview],
  );

  const averageLabel =
    granularity === "day" ? "Tageszüge" : "Ø Züge pro Tag";
  const trend = overview?.summary.change_percent;
  const trendLabel =
    trend == null
      ? "Noch kein Vergleichszeitraum"
      : `${trend > 0 ? "+" : ""}${numberFormat.format(trend)} % zum vorherigen Zeitraum`;
  const latest = overview?.latest;

  return (
    <div className="app-grid vape-tracker">
      <PageHeader
        eyebrow="Vape Tracker"
        title="Counter & Verlauf"
        subtitle="Zwei Einträge am Tag reichen. Die erste Differenz eines neuen Tages wird dem Vortag zugerechnet."
        right={
          latest ? (
            <Badge tone={latest.event_type === "coil_change" ? "warning" : "teal"}>
              Aktueller Counter: {latest.counter}
            </Badge>
          ) : null
        }
      />

      <Card module className="vape-tracker__entry-card" accent="var(--teal)">
        <form className="vape-tracker__form" onSubmit={handleSubmit}>
          <div>
            <label className="input-label" htmlFor="vape-counter">
              Aktueller Zählcounter
            </label>
            <p className="vape-tracker__helper">
              Datum und Uhrzeit setzt das System beim Speichern automatisch.
            </p>
          </div>
          <div className="vape-tracker__input-row">
            <input
              id="vape-counter"
              className="input vape-tracker__counter-input"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              placeholder="z. B. 1842"
              value={counter}
              onChange={(event) => setCounter(event.target.value)}
              autoFocus
            />
            <Button
              type="submit"
              icon={<Check size={15} aria-hidden />}
              disabled={submitting || validCounter === null}
              style={{ opacity: submitting || validCounter === null ? 0.55 : 1 }}
            >
              Counter speichern
            </Button>
            <Button
              variant="secondary"
              icon={<RotateCcw size={15} aria-hidden />}
              disabled={submitting || validCounter === null}
              onClick={() => void submit("coil_change")}
              style={{ opacity: submitting || validCounter === null ? 0.55 : 1 }}
            >
              Coil gewechselt
            </Button>
          </div>
        </form>

        <p className="vape-tracker__reset-note">
          „Coil gewechselt“ speichert zuerst den eingetragenen Endstand und setzt den laufenden
          Counter anschließend auf 0. Der Vorgang landet gemeinsam im Log.
        </p>

        {error ? <div className="vape-tracker__message is-error">{error}</div> : null}
        {confirmation ? (
          <div className="vape-tracker__message is-success">{confirmation}</div>
        ) : null}
      </Card>

      <div className="vape-tracker__metrics">
        <Metric
          label="Züge heute"
          value={loading ? "…" : numberFormat.format(overview?.summary.today_puffs ?? 0)}
          hint="inklusive heutiger Abendwerte"
        />
        <Metric
          label="Ø pro Tag"
          value={loading ? "…" : numberFormat.format(overview?.summary.average_per_day ?? 0)}
          hint={`${overview?.summary.days_with_data ?? 0} erfasste Tage`}
        />
        <Metric
          label="Entwicklung"
          value={trend == null ? "–" : `${trend > 0 ? "+" : ""}${numberFormat.format(trend)} %`}
          hint={trendLabel}
        />
        <Metric
          label="Coil Wechsel"
          value={loading ? "…" : numberFormat.format(overview?.summary.coil_changes ?? 0)}
          hint="im gewählten Zeitraum"
        />
      </div>

      <SectionHeader label="Auswertung" />
      <Card className="vape-tracker__chart-card">
        <div className="vape-tracker__analytics-header">
          <div>
            <h2>{averageLabel}</h2>
            <p>
              {granularity === "day"
                ? "Die Zugdifferenz je Kalendertag."
                : `Tagesmittel innerhalb der gewählten ${granularity === "week" ? "Wochen" : "Monate"}.`}
            </p>
          </div>
          <div className="vape-tracker__controls">
            <SegmentedControl
              options={GRANULARITY_OPTIONS}
              value={granularity}
              onChange={(value) => {
                const next = value as VapeGranularity;
                setGranularity(next);
                setRange(DEFAULT_RANGE[next]);
              }}
            />
            <SegmentedControl
              options={RANGE_OPTIONS[granularity]}
              value={range}
              onChange={(value) => setRange(value as VapeRange)}
            />
          </div>
        </div>

        {chartData.length > 0 ? (
          <BarChart
            data={chartData}
            dataKey="value"
            xKey="period"
            color={CHART_COLORS.teal}
            height={280}
            valueFormatter={(value) => numberFormat.format(value)}
            xTickFormatter={formatDate}
          />
        ) : (
          <div className="vape-tracker__empty">
            {loading ? "Auswertung wird geladen…" : "Noch keine Vape Einträge vorhanden."}
          </div>
        )}
      </Card>

      <SectionHeader label="Letzte Einträge" />
      <Card>
        <div className="vape-tracker__log-list">
          {(overview?.entries ?? []).map((entry) => (
            <div className="vape-tracker__log-row" key={entry.id}>
              <div>
                <strong>{entryLabel(entry)}</strong>
                <span>{formatDateTime(entry.timestamp)}</span>
              </div>
              {entry.event_type === "coil_change" ? (
                <Badge tone="warning">Coil Wechsel</Badge>
              ) : (
                <Badge tone="neutral">+{entry.delta} Züge</Badge>
              )}
            </div>
          ))}
          {!loading && (overview?.entries.length ?? 0) === 0 ? (
            <div className="vape-tracker__empty">Der erste Counter wartet noch auf seinen Auftritt.</div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
