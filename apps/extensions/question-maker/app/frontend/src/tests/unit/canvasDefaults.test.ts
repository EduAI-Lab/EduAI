import { describe, expect, it } from 'vitest';
import { getCanvasDefaultUrl } from '../../services/canvasDefaults';

describe('getCanvasDefaultUrl', () => {
  it('uses an HTTPS test endpoint during development', () => {
    expect(getCanvasDefaultUrl(true)).toBe('https://canvas.test');
  });

  it('uses UBC Canvas outside development', () => {
    expect(getCanvasDefaultUrl(false)).toBe('https://canvas.ubc.ca');
  });
});
