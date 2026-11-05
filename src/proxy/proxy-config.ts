export function parseHttpsOriginMap(raw: string | undefined): Record<string, string> {
  if (!raw) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      continue;
    }
    try {
      const url = new URL(value);
      if (
        url.protocol === 'https:' &&
        url.origin === value.replace(/\/$/, '') &&
        !url.username &&
        !url.password &&
        url.toString() === `${url.origin}/`
      ) {
        result[key] = url.origin;
      }
    } catch {
      continue;
    }
  }
  return result;
}

export function parseHttpsUrlMap(raw: string | undefined): Record<string, string> {
  if (!raw) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      continue;
    }
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && !url.username && !url.password) {
        result[key] = url.toString();
      }
    } catch {
      continue;
    }
  }
  return result;
}

export function isValidEsploraPath(path: string): boolean {
  if (!path || path.startsWith('/')) {
    return false;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return false;
  }
  if (path.includes('..') || decoded.includes('..')) {
    return false;
  }
  if (
    /^[a-z][a-z0-9+.-]*:/i.test(path) ||
    /^[a-z][a-z0-9+.-]*:/i.test(decoded) ||
    path.startsWith('//') ||
    decoded.startsWith('//')
  ) {
    return false;
  }
  try {
    const base = new URL('https://wallet.invalid/');
    const joined = new URL(path, base);
    return joined.origin === base.origin;
  } catch {
    return false;
  }
}

export function isValidEsploraQuery(query: string): boolean {
  if (!query) {
    return true;
  }
  if (!query.startsWith('?')) {
    return false;
  }
  const suffix = query.slice(1);
  if (!suffix || suffix.includes('..') || suffix.includes('\\')) {
    return false;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(suffix);
  } catch {
    return false;
  }
  return !decoded.includes('..') && !decoded.includes('\\') && !/^[a-z][a-z0-9+.-]*:/i.test(decoded);
}

export function parsePriceHosts(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}
