export function parseLoadtestHttpUrl(value: string): {
  protocol: string;
  hostname: string;
};

export function resolveLoadtestBaseUrl(
  raw: string | undefined,
  allowRemote: string | undefined,
): string;
