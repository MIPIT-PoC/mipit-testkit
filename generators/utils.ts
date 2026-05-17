import { ulid } from 'ulid';
import { randomInt, randomBytes } from 'node:crypto';

export function randomAmount(min = 10, max = 10000): number {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

/**
 * P10 — Generate a valid CPF (Brazilian individual tax ID) with mod-11
 * checksum. The previous `randomPixKey` produced base64-ish gibberish that
 * the BCB DICT validator would reject immediately.
 */
export function randomCPF(): string {
  const base = Array.from({ length: 9 }, () => randomInt(10));
  // First check digit
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += base[i] * (10 - i);
  let d1 = 11 - (sum % 11);
  if (d1 >= 10) d1 = 0;
  base.push(d1);
  // Second check digit
  sum = 0;
  for (let i = 0; i < 10; i++) sum += base[i] * (11 - i);
  let d2 = 11 - (sum % 11);
  if (d2 >= 10) d2 = 0;
  base.push(d2);
  return base.join('');
}

/** P10 — Brazilian mobile phone (+55 11 9XXXX XXXX). */
export function randomPixPhone(): string {
  const area = String(randomInt(10, 100)); // DDD 10-99
  const digits = Array.from({ length: 9 }, () => randomInt(10)).join('');
  return `+55${area}${digits}`;
}

/** P10 — Email PIX key. */
export function randomPixEmail(): string {
  const prefix = randomBytes(4).toString('hex');
  return `user.${prefix}@mipit.test`;
}

/** P10 — EVP (UUIDv4) PIX key. */
export function randomEVP(): string {
  // Use Node's built-in webcrypto for UUIDv4
  return require('node:crypto').randomUUID();
}

/**
 * P10 — Generate a random PIX key of any DICT-accepted type.
 * Replaces the legacy `randomPixKey` (which produced unparseable garbage).
 */
export function randomPixKey(type?: 'CPF' | 'PHONE' | 'EMAIL' | 'EVP'): string {
  const t = type ?? (['CPF', 'PHONE', 'EMAIL', 'EVP'] as const)[randomInt(4)];
  switch (t) {
    case 'CPF': return randomCPF();
    case 'PHONE': return randomPixPhone();
    case 'EMAIL': return randomPixEmail();
    case 'EVP': return randomEVP();
  }
}

/**
 * P10 — Generate a valid CLABE (Mexican bank account, 18 digits with mod-10
 * weighted check digit). Default bank prefix is 072 (Banorte).
 *
 * The previous `randomClabe` emitted 18 random digits with no check —
 * STP/CECOBAN would reject 9 out of 10.
 */
export function randomClabe(bankPrefix = '072'): string {
  const padded = bankPrefix.padStart(3, '0');
  const body = padded + Array.from({ length: 14 }, () => randomInt(10)).join('');
  const weights = [3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7];
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += parseInt(body[i], 10) * weights[i];
  const checkDigit = (10 - (sum % 10)) % 10;
  return body + checkDigit;
}

/**
 * P10 — Generate a valid Colombian NIT (9-10 digits + DIAN mod-11 check).
 */
export function randomNIT(): string {
  const len = randomInt(9, 11);
  const digits = Array.from({ length: len }, (_, i) => i === 0 ? randomInt(1, 10) : randomInt(10));
  const weights = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  const reversed = [...digits].reverse();
  let sum = 0;
  for (let i = 0; i < reversed.length; i++) sum += reversed[i] * weights[i];
  const rem = sum % 11;
  const check = rem < 2 ? rem : 11 - rem;
  return `${digits.join('')}-${check}`;
}

/** P10 — Colombian Cédula de Ciudadanía (6-10 digits). */
export function randomCC(): string {
  const len = randomInt(8, 11);
  return Array.from({ length: len }, () => randomInt(10)).join('');
}

/** P10 — Colombian mobile (+57 3xx XXX XXXX). */
export function randomBrebPhone(): string {
  // mobile prefix `3` + 9 digits
  return '+573' + Array.from({ length: 9 }, () => randomInt(10)).join('');
}

/** P10 — Bre-B alphanumeric ALIAS with @ prefix per BanRep. */
export function randomBrebAlias(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789._';
  const len = randomInt(4, 16);
  let s = '@';
  for (let i = 0; i < len; i++) s += chars[randomInt(chars.length)];
  return s;
}

/** P10 — Random Bre-B llave (any type). */
export function randomBrebKey(type?: 'CC' | 'NIT' | 'PHONE' | 'EMAIL' | 'ALIAS'): string {
  const t = type ?? (['CC', 'NIT', 'PHONE', 'EMAIL', 'ALIAS'] as const)[randomInt(5)];
  switch (t) {
    case 'CC': return randomCC();
    case 'NIT': return randomNIT();
    case 'PHONE': return randomBrebPhone();
    case 'EMAIL': return randomPixEmail(); // reuse email gen
    case 'ALIAS': return randomBrebAlias();
  }
}

export function randomName(): string {
  const firstNames = ['Alice', 'Bob', 'Carlos', 'Diana', 'Eduardo', 'Fernanda', 'Gustavo', 'Helena'];
  const lastNames = ['Silva', 'García', 'Rodríguez', 'Martínez', 'López', 'Hernández', 'Pereira'];
  return `${firstNames[Math.floor(Math.random() * firstNames.length)]} ${lastNames[Math.floor(Math.random() * lastNames.length)]}`;
}

export function randomPurpose(): string {
  const purposes = ['P2P', 'TRANSFER', 'PAYMENT', 'REMITTANCE', 'INVOICE'];
  return purposes[Math.floor(Math.random() * purposes.length)];
}

export function paymentId(): string {
  return `PMT-${ulid()}`;
}
