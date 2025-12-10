export async function fetchTasks() {
  const res = await fetch("/api/quick-capture/tasks");
  return res.json();
}

export async function addTask(text: string) {
  const res = await fetch("/api/quick-capture/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error("Failed to add task");
  return res.json();
}
