/**
 * @file jest.config.ts
 * @description Jest configuration for the validation testkit: ts-jest preset, Node test environment, *.test.ts discovery under tests/, and coverage settings.
 * @author Miguel Ángel Rico
 * @project MIPIT-PoC — Cross-border Instant Payments Middleware
 */
import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  verbose: true,
};

export default config;
