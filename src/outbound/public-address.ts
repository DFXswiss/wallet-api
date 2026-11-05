import { isIP } from 'node:net';

function parseIpv4(address: string): number[] | null {
  const parts = address.split('.');
  if (parts.length !== 4) {
    return null;
  }
  const numbers = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  return numbers.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? numbers : null;
}

function isPublicIpv4(address: string): boolean {
  const parts = parseIpv4(address);
  if (!parts) {
    return false;
  }
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a >= 224) return false;
  return true;
}

function expandIpv6(address: string): number[] | null {
  let input = address;
  const zoneIndex = input.indexOf('%');
  if (zoneIndex >= 0) {
    input = input.slice(0, zoneIndex);
  }
  if (input.includes('.')) {
    const lastColon = input.lastIndexOf(':');
    const ipv4Text = input.slice(lastColon + 1);
    const ipv4 = parseIpv4(ipv4Text);
    if (!ipv4) {
      return null;
    }
    const high = ((ipv4[0] << 8) | ipv4[1]).toString(16);
    const low = ((ipv4[2] << 8) | ipv4[3]).toString(16);
    input = `${input.slice(0, lastColon + 1)}${high}:${low}`;
  }
  const halves = input.split('::');
  if (halves.length > 2) {
    return null;
  }
  const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 && missing !== 0) {
    return null;
  }
  if (halves.length === 2 && missing < 1) {
    return null;
  }
  const words = [...left, ...Array<string>(Math.max(0, missing)).fill('0'), ...right].map((part) =>
    /^[0-9a-f]{1,4}$/i.test(part) ? parseInt(part, 16) : NaN,
  );
  if (words.some((word) => Number.isNaN(word))) {
    return null;
  }
  return words.length === 8 ? words : null;
}

function isPublicIpv6(address: string): boolean {
  const words = expandIpv6(address);
  if (!words) {
    return false;
  }
  if (words.every((word) => word === 0)) return false;
  if (words.slice(0, 7).every((word) => word === 0) && words[7] === 1) return false;
  if ((words[0] & 0xfe00) === 0xfc00) return false;
  if ((words[0] & 0xffc0) === 0xfe80) return false;
  if ((words[0] & 0xffc0) === 0xfec0) return false;
  if ((words[0] & 0xff00) === 0xff00) return false;
  if (words[0] === 0x3fff && (words[1] & 0xf000) === 0) return false;
  if (words[0] === 0x2001 && words[1] === 0x0db8) return false;
  if (words[0] === 0x2001 && words[1] === 0x0002) return false;
  if (words[0] === 0x2001 && words[1] === 0x0010) return false;
  if (words[0] === 0x2001 && words[1] === 0) return false;
  if (words[0] === 0x2002) return false;
  if (words[0] === 0x0064 && words[1] === 0xff9b && words[2] === 0 && words[3] === 0) return false;
  if (words[0] === 0x0064 && words[1] === 0xff9b && words[2] === 0x0001) return false;
  if (words[0] === 0x0100 && words[1] === 0 && words[2] === 0 && words[3] === 0) return false;
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    return isPublicIpv4(`${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`);
  }
  if (words.slice(0, 6).every((word) => word === 0)) {
    return false;
  }
  return true;
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return isPublicIpv4(address);
  }
  if (family === 6) {
    return isPublicIpv6(address);
  }
  return false;
}
