const PRODUCTION_CANVAS_URL = "https://canvas.ubc.ca";

const RESERVED_HOSTS = new Set(["localhost", "localhost.localdomain"]);
const RESERVED_SUFFIXES = [".test", ".invalid", ".localhost", ".local", ".example"];

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }

  return (
    octets[0] === 0 ||
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

/**
 * The backend applies an HTTPS + public-address SSRF guard to Canvas
 * connections. The frontend cannot perform DNS resolution, but it can avoid
 * shipping a value that is known to be HTTP, local, private, or reserved.
 */
export function isUsableCanvasDefaultUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      hostname.length > 0 &&
      !RESERVED_HOSTS.has(hostname) &&
      !RESERVED_SUFFIXES.some((suffix) => hostname.endsWith(suffix)) &&
      !isPrivateIpv4(hostname) &&
      hostname !== "::1"
    );
  } catch {
    return false;
  }
}

/**
 * Development has no universal Canvas host. A real HTTPS sandbox host can be
 * supplied through VITE_CANVAS_DEFAULT_URL; otherwise the form stays empty so
 * the user must enter the account-specific host that they can actually reach.
 */
export function getCanvasDefaultUrl(
  isDevelopment: boolean,
  configuredUrl: string | undefined = import.meta.env.VITE_CANVAS_DEFAULT_URL,
): string {
  const trimmed = configuredUrl?.trim();
  if (trimmed && isUsableCanvasDefaultUrl(trimmed)) return trimmed.replace(/\/+$/, "");
  return isDevelopment ? "" : PRODUCTION_CANVAS_URL;
}
