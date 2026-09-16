import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getStaffAuthEmail,
  getStaffConfiguredPassword,
  normalizeStaffUsername,
} from './staff-login';

describe('normalizeStaffUsername', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeStaffUsername('  coordzed  ')).toBe('coordzed');
  });

  it('lowercases mixed casing', () => {
    expect(normalizeStaffUsername('CoordZed')).toBe('coordzed');
    expect(normalizeStaffUsername('JOHIAAPP')).toBe('johiaapp');
  });

  it('handles empty and whitespace-only input', () => {
    expect(normalizeStaffUsername('')).toBe('');
    expect(normalizeStaffUsername('   ')).toBe('');
  });

  it('normalizes before returning auth email', () => {
    expect(getStaffAuthEmail(' CoordZed ')).toBe('coordzed@johiabankers.com');
  });
});

describe('getStaffConfiguredPassword', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the documented default for the admin username', () => {
    vi.stubEnv('ADMIN_LOGIN_PASSWORD', '');
    vi.stubEnv('ADMIN_LOGIN_USERNAME', '');
    expect(getStaffConfiguredPassword('johiaapp')).toBe('johia2026');
    expect(getStaffConfiguredPassword('  JohiaApp ')).toBe('johia2026');
  });

  it('honors ADMIN_LOGIN_PASSWORD when configured', () => {
    vi.stubEnv('ADMIN_LOGIN_PASSWORD', 'admin-secret-99');
    expect(getStaffConfiguredPassword('johiaapp')).toBe('admin-secret-99');
  });

  it('honors ADMIN_LOGIN_USERNAME when configured', () => {
    vi.stubEnv('ADMIN_LOGIN_USERNAME', 'developer');
    vi.stubEnv('ADMIN_LOGIN_PASSWORD', '');
    expect(getStaffConfiguredPassword('developer')).toBe('johia2026');
    expect(getStaffConfiguredPassword('johiaapp')).toBeNull();
  });

  it('returns the documented default for coordinator usernames', () => {
    vi.stubEnv('COORDINATOR_LOGIN_PASSWORD', '');
    expect(getStaffConfiguredPassword('coordzed')).toBe('coord2026');
    expect(getStaffConfiguredPassword('coordmarilyn')).toBe('coord2026');
    expect(getStaffConfiguredPassword('CoordZed')).toBe('coord2026');
  });

  it('honors COORDINATOR_LOGIN_PASSWORD for all coordinators', () => {
    vi.stubEnv('COORDINATOR_LOGIN_PASSWORD', 'coord-secret-77');
    expect(getStaffConfiguredPassword('coordzed')).toBe('coord-secret-77');
    expect(getStaffConfiguredPassword('coordmarilyn')).toBe('coord-secret-77');
  });

  it('returns null for unknown usernames', () => {
    vi.stubEnv('ADMIN_LOGIN_USERNAME', '');
    vi.stubEnv('ADMIN_LOGIN_PASSWORD', '');
    vi.stubEnv('COORDINATOR_LOGIN_PASSWORD', '');
    expect(getStaffConfiguredPassword('dave')).toBeNull();
    expect(getStaffConfiguredPassword('')).toBeNull();
    expect(getStaffConfiguredPassword('rachel')).toBeNull();
  });
});

describe('getStaffAuthEmail', () => {
  it('builds the deterministic auth email from a username', () => {
    expect(getStaffAuthEmail('johiaapp')).toBe('johiaapp@johiabankers.com');
    expect(getStaffAuthEmail('coordzed')).toBe('coordzed@johiabankers.com');
    expect(getStaffAuthEmail('coordmarilyn')).toBe('coordmarilyn@johiabankers.com');
  });
});