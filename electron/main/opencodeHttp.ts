export const requestOpenCodeJSON = async (
  baseUrl: string,
  pathname: string,
  init?: RequestInit,
  timeoutMs = 10_000,
) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${pathname}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `OpenCode ${response.status} ${response.statusText}${
          detail ? `: ${detail.slice(0, 300)}` : ""
        }`,
      );
    }
    if (response.status === 204) return undefined;
    const text = await response.text();
    return text ? (JSON.parse(text) as unknown) : undefined;
  } finally {
    clearTimeout(timer);
  }
};

export const parseOpenCodeSSEBlock = (block: string) => {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  if (!data) return undefined;
  return JSON.parse(data) as unknown;
};
