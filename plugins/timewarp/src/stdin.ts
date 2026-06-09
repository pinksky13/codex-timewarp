export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readStdinJson(): Promise<unknown> {
  const body = await readStdin();
  if (!body.trim()) {
    return null;
  }
  return JSON.parse(body);
}
