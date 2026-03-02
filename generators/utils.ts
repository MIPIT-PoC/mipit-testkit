import { ulid } from 'ulid';

export function randomAmount(min = 10, max = 10000): number {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

export function randomPixKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-';
  const len = 8 + Math.floor(Math.random() * 20);
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export function randomClabe(): string {
  return Array.from({ length: 18 }, () => Math.floor(Math.random() * 10)).join('');
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
