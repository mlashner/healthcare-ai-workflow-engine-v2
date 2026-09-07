export function formatCitationId(documentId: string, chunkIndex: number): string {
  return `cite:${documentId}:${chunkIndex}`;
}

export function parseCitationId(
  citationId: string,
): { documentId: string; chunkIndex: number } | null {
  const match = /^cite:([A-Za-z0-9_-]+):(\d+)$/.exec(citationId);
  if (!match?.[1] || match[2] === undefined) {
    return null;
  }
  return {
    documentId: match[1],
    chunkIndex: Number(match[2]),
  };
}
