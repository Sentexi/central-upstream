from ...core.module_base import BaseModule


class HealthModule(BaseModule):
    id = "health"
    name = "Health"
    version = "0.1.0"

    def init_app(self, app):
        from .repository import HealthRepository
        from .routes import _get_db_path, _load_table_schemas, bp
        from .sync_manager import HealthSyncManager
        from .workout_backfill import register_workout_commands
        from .workout_repository import WorkoutRepository

        app.register_blueprint(bp, url_prefix="/api/health")

        with app.app_context():
            db_path = _get_db_path()
            schemas = _load_table_schemas()
            repo = HealthRepository(db_path, table_schemas=schemas)
            workout_repo = WorkoutRepository(db_path)
            manager = HealthSyncManager(
                repo=repo,
                workout_repo=workout_repo,
                app=app,
            )
            app.extensions["health_repo"] = repo
            app.extensions["health_workout_repo"] = workout_repo
            app.extensions["health_sync_manager"] = manager
            register_workout_commands(app, workout_repo)

    def get_manifest(self) -> dict:
        manifest = super().get_manifest()
        manifest["slots"] = ["health_view", "fitness_view"]
        return manifest

    def check_ready(self) -> bool:
        # Health benötigt keine externen Credentials und ist sofort bereit.
        return True


module = HealthModule()
