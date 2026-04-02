export function createTimestampRunId(avoid: string[] = []): string {
  const date = new Date()

  while (true) {
    const candidate = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
      String(date.getHours()).padStart(2, "0"),
      String(date.getMinutes()).padStart(2, "0"),
      String(date.getSeconds()).padStart(2, "0"),
    ].join("")

    if (!avoid.includes(candidate)) {
      return candidate
    }

    date.setSeconds(date.getSeconds() + 1)
  }
}
