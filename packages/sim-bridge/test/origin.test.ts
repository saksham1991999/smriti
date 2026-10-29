import { describe, expect, it } from 'vitest';
import { isOriginAllowed, isUrlUnderPrefix, normalizeOrigin } from '../src/origin';

describe('normalizeOrigin', () => {
  it('lower-cases and drops default ports', () => {
    expect(normalizeOrigin('HTTPS://Sims.Example.App:443')).toBe('https://sims.example.app');
    expect(normalizeOrigin('http://localhost:5173')).toBe('http://localhost:5173');
    expect(normalizeOrigin('null')).toBe('null');
  });

  it('refuses things that are not origins', () => {
    expect(normalizeOrigin('https://a.app/path')).toBeNull();
    expect(normalizeOrigin('not a url')).toBeNull();
  });
});

describe('isOriginAllowed', () => {
  const policy = { allowed: ['https://sims.smriti.app', 'https://*.preview.smriti.app'] };

  it('matches exact origins', () => {
    expect(isOriginAllowed('https://sims.smriti.app', policy)).toBe(true);
    expect(isOriginAllowed('https://sims.smriti.app:443', policy)).toBe(true);
    expect(isOriginAllowed('http://sims.smriti.app', policy)).toBe(false);
    expect(isOriginAllowed('https://sims.smriti.app.evil.com', policy)).toBe(false);
  });

  it('matches wildcard subdomains but not the bare domain or look-alikes', () => {
    expect(isOriginAllowed('https://pr-12.preview.smriti.app', policy)).toBe(true);
    expect(isOriginAllowed('https://preview.smriti.app', policy)).toBe(false);
    expect(isOriginAllowed('https://evilpreview.smriti.app', policy)).toBe(false);
  });

  it('accepts the opaque origin only when asked', () => {
    expect(isOriginAllowed('null', policy)).toBe(false);
    expect(isOriginAllowed('null', { ...policy, allowOpaque: true })).toBe(true);
  });
});

describe('isUrlUnderPrefix', () => {
  const prefixes = ['file:///data/user/0/app/files/sims/simple-pendulum/1.0.0/'];

  it('accepts files inside the sim folder', () => {
    expect(isUrlUnderPrefix('file:///data/user/0/app/files/sims/simple-pendulum/1.0.0/index.html', prefixes)).toBe(true);
    expect(isUrlUnderPrefix('file:///data/user/0/app/files/sims/simple-pendulum/1.0.0/assets/sim.js?x=1', prefixes)).toBe(true);
  });

  it('refuses other folders, climbing paths and other schemes', () => {
    expect(isUrlUnderPrefix('file:///data/user/0/app/files/sims/other/index.html', prefixes)).toBe(false);
    expect(isUrlUnderPrefix('file:///data/user/0/app/files/sims/simple-pendulum/1.0.0/../../other/index.html', prefixes)).toBe(false);
    expect(isUrlUnderPrefix('file:///data/user/0/app/files/sims/simple-pendulum/1.0.0/%2e%2e/x.html', prefixes)).toBe(false);
    expect(isUrlUnderPrefix('https://evil.example/data/user/0/app/files/sims/simple-pendulum/1.0.0/index.html', prefixes)).toBe(false);
  });

  it('ignores prefixes that are not folders', () => {
    expect(isUrlUnderPrefix('file:///a/bc.html', ['file:///a/b'])).toBe(false);
  });
});
