import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseExtraExtensions } from '~/lib/apps'

afterEach(() => vi.unstubAllEnvs())

describe('parseExtraExtensions', () => {
  it('returns [] when VITE_EXTRA_EXTENSIONS is empty or unset', () => {
    vi.stubEnv('VITE_EXTRA_EXTENSIONS', '')
    expect(parseExtraExtensions()).toEqual([])
  })

  it('returns [] for malformed JSON', () => {
    vi.stubEnv('VITE_EXTRA_EXTENSIONS', 'not-json')
    expect(parseExtraExtensions()).toEqual([])
  })

  it('returns [] when JSON is not an array', () => {
    vi.stubEnv('VITE_EXTRA_EXTENSIONS', '{"id":"x","name":"X","url":"http://x.com"}')
    expect(parseExtraExtensions()).toEqual([])
  })

  it('parses a valid entry and sets all fields', () => {
    vi.stubEnv('VITE_EXTRA_EXTENSIONS', '[{"id":"example","name":"Example","url":"http://localhost:9000"}]')
    const apps = parseExtraExtensions()
    expect(apps).toHaveLength(1)
    expect(apps[0].id).toBe('example')
    expect(apps[0].name).toBe('Example')
    expect(apps[0].url).toBe('http://localhost:9000')
    expect(apps[0].icon).toBeTruthy()
    expect(apps[0].color).toBe('oklch(0.580 0.150 300)')
  })

  it('uses a custom color when provided', () => {
    vi.stubEnv('VITE_EXTRA_EXTENSIONS', '[{"id":"x","name":"X","url":"http://x.com","color":"oklch(0.5 0.1 200)"}]')
    expect(parseExtraExtensions()[0].color).toBe('oklch(0.5 0.1 200)')
  })

  it('passes through the description field', () => {
    vi.stubEnv('VITE_EXTRA_EXTENSIONS', '[{"id":"x","name":"X","url":"http://x.com","description":"A demo"}]')
    expect(parseExtraExtensions()[0].description).toBe('A demo')
  })

  it('filters out entries missing a required field', () => {
    vi.stubEnv('VITE_EXTRA_EXTENSIONS', '[{"id":"x","name":"X"},{"id":"y","name":"Y","url":"http://y.com"}]')
    const apps = parseExtraExtensions()
    expect(apps).toHaveLength(1)
    expect(apps[0].id).toBe('y')
  })

  it('filters out entries where a required field is not a string', () => {
    vi.stubEnv('VITE_EXTRA_EXTENSIONS', '[{"id":1,"name":"X","url":"http://x.com"}]')
    expect(parseExtraExtensions()).toHaveLength(0)
  })

  it('parses multiple valid entries', () => {
    vi.stubEnv('VITE_EXTRA_EXTENSIONS', '[{"id":"a","name":"A","url":"http://a.com"},{"id":"b","name":"B","url":"http://b.com"}]')
    expect(parseExtraExtensions()).toHaveLength(2)
  })
})
