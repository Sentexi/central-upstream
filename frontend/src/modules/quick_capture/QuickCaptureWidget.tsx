import { FormEvent, useEffect, useState } from "react";
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
    } catch (err) {
      console.error("Failed to add task", err);
      setError("Failed to add task");
    }
  }

  return (
    <div>
      <h3>Quick Capture</h3>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="What needs to be done?"
        />
        <button type="submit">Add</button>
      </form>

      {loading && <p>Loading tasks...</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}

      <ul>
        {tasks.map((task) => (
          <li key={task.id}>{task.text}</li>
        ))}
      </ul>
    </div>
  );
}
