from __future__ import annotations

import json
import os
from pathlib import Path

import click

from .workout_repository import WorkoutRepository


def register_workout_commands(app, workout_repo: WorkoutRepository):
    @app.cli.command("backfill-health-workouts")
    @click.option(
        "--payload-dir",
        type=click.Path(path_type=Path, file_okay=False),
        default=None,
        help="Ordner mit archivierten Health Auto Export JSON-Payloads.",
    )
    def backfill_health_workouts(payload_dir: Path | None):
        """Import archived workout payloads into the normalized workout tables."""

        if payload_dir is None:
            payload_dir = Path(workout_repo.db_path).resolve().parent / "payloads"
        if not payload_dir.is_dir():
            raise click.ClickException(f"Payload-Ordner fehlt: {payload_dir}")

        # Imported lazily so module startup does not create a routes/workout
        # repository import cycle.
        from .routes import _normalize_payload

        files_seen = 0
        records_seen = 0
        failed_files = 0
        for payload_path in sorted(payload_dir.glob("*.json")):
            files_seen += 1
            try:
                with payload_path.open("r", encoding="utf-8") as handle:
                    payload = json.load(handle)
            except (OSError, json.JSONDecodeError):
                failed_files += 1
                continue

            workout_records = [
                record
                for record in _normalize_payload(payload)
                if record.data_type.casefold() == "workouts"
            ]
            if not workout_records:
                continue
            records_seen += len(workout_records)
            workout_repo.ingest_records(
                workout_records,
                batch_ts=int(os.path.getmtime(payload_path)),
            )

        click.echo(
            "Workout-Backfill abgeschlossen: "
            f"{files_seen} Dateien, {records_seen} Workout-Zeilen, "
            f"{workout_repo.count_sessions()} eindeutige Sessions, "
            f"{failed_files} fehlerhafte Dateien."
        )
