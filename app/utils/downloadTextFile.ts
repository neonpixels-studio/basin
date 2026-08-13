// Triggers a browser download of an in-memory text payload. Isolated here so
// composables that build export payloads (OPML feeds, JSON account export) stay
// testable without a real DOM download, and share one implementation.
export function downloadTextFile(
  filename: string,
  content: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
