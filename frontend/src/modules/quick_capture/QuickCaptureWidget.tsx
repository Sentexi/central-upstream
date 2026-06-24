import { FormEvent, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { GlassCard } from "../../core/GlassCard";
import { addTask, fetchTasks } from "./api";

type Task = {
  id: number;
  text: string;
  created_at?: string;
};

export function QuickCaptureWidget() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newText, setNewText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTasks()
      .then((data) => {
        setTasks(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load tasks", err);
        setError("Failed to load tasks");
        setLoading(false);
      });
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = newText.trim();
    if (!text) return;
    try {
      const task = await addTask(text);
      setTasks((prev) => [...prev, task]);
      setNewText("");
      setError(null);
    } catch (err) {
      console.error("Failed to add task", err);
      setError("Failed to add task");
    }
  }

  return (
    <GlassCard className="quick-capture">
      <div className="section-heading">Quick Capture</div>
      <p className="card-description">
        Schnelles Eingabefeld ohne Reibung. Neue Einträge erscheinen sofort in deiner
        Today-Liste.
      </p>

      <form onSubmit={handleSubmit} className="stack" aria-label="Quick capture form">
        <div className="input-row">
          <input
            className="input"
            type="text"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="Was muss passieren?"
            aria-label="Neuen Task eintragen"
          />
          <button className="button" type="submit">
            <Plus size={15} strokeWidth={2} aria-hidden />
            Erfassen
          </button>
        </div>
        <span className="muted">Enter speichert sofort.</span>
      </form>

      {loading && <p className="muted">Lädt…</p>}
      {error && <p className="badge-alert">{error}</p>}

      {!loading && tasks.length === 0 && !error && (
        <p className="muted">Noch keine Einträge, starte mit dem ersten.</p>
      )}

      {tasks.length > 0 && (
        <ul className="task-list">
          {tasks.map((task) => (
            <li key={task.id} className="task-item">
              <div>{task.text}</div>
              {task.created_at && (
                <span className="muted" aria-label="Creation timestamp">
                  {task.created_at}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </GlassCard>
  );
}
