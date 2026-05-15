#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const SENSITIVE_KEY = /(authorization|token|secret|password|jwt)/i;

function ensureDir(dir) {
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
}

function timestamp() {
  return new Date().toISOString();
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function redactForLogs(value) {
  if (value == null) return value;

  if (Array.isArray(value)) {
    return value.map((item) => redactForLogs(item));
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, innerValue]) => {
        if (SENSITIVE_KEY.test(key)) {
          return [key, '[REDACTED]'];
        }
        return [key, redactForLogs(innerValue)];
      }),
    );
  }

  if (typeof value === 'string' && value.startsWith('Bearer ')) {
    return 'Bearer [REDACTED]';
  }

  return value;
}

function stringify(value) {
  if (typeof value === 'string') return value;
  return JSON.stringify(redactForLogs(value), null, 2);
}

export function createTraceLogger(name) {
  const traceDir = process.env.MIPIT_TRACE_DIR;
  const tracePath = traceDir ? path.join(traceDir, `${name}.trace.log`) : null;
  if (tracePath) {
    ensureDir(path.dirname(tracePath));
  }

  function write(line) {
    console.log(line);
    if (tracePath) {
      fs.appendFileSync(tracePath, `${line}\n`, 'utf8');
    }
  }

  function writeBlock(prefix, value) {
    const text = stringify(value)
      .split(/\r?\n/)
      .map((line) => `${prefix}${line}`)
      .join('\n');
    write(text);
  }

  return {
    tracePath,
    banner(message) {
      write(`[${timestamp()}] [${name}] === ${message} ===`);
    },
    step(message, details) {
      write(`[${timestamp()}] [${name}] STEP ${message}`);
      if (details !== undefined) {
        writeBlock(`[${timestamp()}] [${name}] DATA `, details);
      }
    },
    request(label, details) {
      write(`[${timestamp()}] [${name}] REQUEST ${label}`);
      writeBlock(`[${timestamp()}] [${name}] > `, details);
    },
    response(label, details) {
      write(`[${timestamp()}] [${name}] RESPONSE ${label}`);
      writeBlock(`[${timestamp()}] [${name}] < `, details);
    },
    event(label, details) {
      write(`[${timestamp()}] [${name}] EVENT ${label}`);
      if (details !== undefined) {
        writeBlock(`[${timestamp()}] [${name}] * `, details);
      }
    },
    error(label, error) {
      write(`[${timestamp()}] [${name}] ERROR ${label}`);
      writeBlock(`[${timestamp()}] [${name}] ! `, {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    },
  };
}

export async function fetchWithTrace(
  logger,
  label,
  url,
  options = {},
  responseMode = 'json',
) {
  const requestHeaders = options.headers ?? {};
  const requestBody =
    typeof options.body === 'string' ? safeJsonParse(options.body) : options.body;

  logger.request(label, {
    method: options.method ?? 'GET',
    url,
    headers: requestHeaders,
    body: requestBody,
  });

  const started = performance.now();

  try {
    const response = await fetch(url, options);
    const rawText = await response.text();
    const elapsedMs = Math.round(performance.now() - started);
    const body =
      responseMode === 'text'
        ? rawText
        : responseMode === 'json'
          ? safeJsonParse(rawText)
          : safeJsonParse(rawText);

    logger.response(label, {
      status: response.status,
      ok: response.ok,
      elapsed_ms: elapsedMs,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    });

    return {
      status: response.status,
      ok: response.ok,
      headers: response.headers,
      elapsedMs,
      body,
      text: rawText,
    };
  } catch (error) {
    logger.error(label, error);
    throw error;
  }
}
