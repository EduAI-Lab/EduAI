/**
 * The backend applies the same SSRF guard to Canvas test-mode connections as
 * it does to production connections, so the test-mode default must be HTTPS.
 */
export function getCanvasDefaultUrl(isDevelopment: boolean): string {
  return isDevelopment ? 'https://canvas.test' : 'https://canvas.ubc.ca';
}
