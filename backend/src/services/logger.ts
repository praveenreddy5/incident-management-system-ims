type Level = "INFO" | "WARN" | "ERROR";

export function log(
  level: Level,
  message: string,
  data: Record<string, unknown> = {}
): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    message,
    ...data,
  };
  const line = JSON.stringify(payload);
  if (level === "ERROR") {
    console.error(line);
    return;
  }
  console.log(line);
}
