export type TaskView = {
  name: string;
  number: number;
  durationMinutes: number;
  createdAt: number;
  dueAt: number;
};

export function shortName(task: Pick<TaskView, "number">): string {
  return `Test task ${task.number}`;
}

export function isFinished(task: Pick<TaskView, "dueAt">, now: number): boolean {
  return now >= task.dueAt;
}

export function minutesWord(n: number): string {
  return n === 1 ? "1 minute" : `${n} minutes`;
}

export function timeLeft(task: Pick<TaskView, "dueAt">, now: number): string {
  const seconds = Math.max(0, (task.dueAt - now) / 1000);
  if (seconds < 60) return "less than a minute left";
  return `about ${minutesWord(Math.ceil(seconds / 60))} left`;
}

export function startedText(task: TaskView): string {
  const name = shortName(task);
  return (
    `Started ${name}. It will take about ${minutesWord(task.durationMinutes)}. ` +
    `If the user wants to be told when it is done, call wait_for_task with name "${name}" now, ` +
    `and call it again each time it says the task is still running. ` +
    `When it says the task is done, tell the user.`
  );
}

export function doneText(task: TaskView): string {
  return `${shortName(task)} is done. It took ${minutesWord(task.durationMinutes)}.`;
}

export function stillRunningText(task: TaskView, now: number): string {
  const name = shortName(task);
  return (
    `${name} is still running, ${timeLeft(task, now)}. ` +
    `Call wait_for_task again with name "${name}" to keep waiting.`
  );
}

export function statusText(task: TaskView, now: number): string {
  if (isFinished(task, now)) return doneText(task);
  return `${shortName(task)} is still running, ${timeLeft(task, now)}.`;
}

export function listLine(task: TaskView, now: number): string {
  if (isFinished(task, now)) {
    return `${task.name}: done, it took ${minutesWord(task.durationMinutes)}.`;
  }
  return `${task.name}: still running, ${timeLeft(task, now)}.`;
}

export function listText(tasks: TaskView[], now: number): string {
  if (tasks.length === 0) return "There are no test tasks yet.";
  return tasks.map((task) => listLine(task, now)).join("\n");
}

export function notFoundText(name: string, recent: TaskView[]): string {
  const known = recent.slice(0, 5).map(shortName).join(", ");
  const hint = known ? ` Recent tasks: ${known}.` : " There are no tasks yet.";
  return `I could not find a task called "${name}".${hint} Use name "last" for the most recent task.`;
}
