export function assertSharedFilePath(value: string): string {
  if (!value || value.includes("\\") || value.includes("\0") || value.startsWith("/") || /^[a-z]:/i.test(value) ||
    value.split("/").some(part => !part || part === "." || part === ".." || part.toLowerCase() === ".git") || value.length > 4096) throw new Error("Invalid collaboration file path")
  return value
}
export function sharedPathComparisonKey(value: string): string {
  return assertSharedFilePath(value).normalize("NFC").toLowerCase()
}
