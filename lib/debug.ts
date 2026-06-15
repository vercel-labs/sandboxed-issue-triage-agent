type DebugMetadata = Record<string, unknown>;

const DEBUG_PREFIX = "[triage-debug]";
const SENSITIVE_KEY_PATTERN = /(api|auth|bearer|cookie|key|password|secret|token)/i;

function redactValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return "[redacted]";
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => redactValue(String(index), item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        redactValue(entryKey, entryValue)
      ])
    );
  }

  return value;
}

export function sanitizeTriageMetadata(metadata: DebugMetadata) {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [key, redactValue(key, value)])
  );
}

export function getTriageErrorMetadata(error: unknown) {
  return error instanceof Error
    ? {
        errorName: error.name,
        errorMessage: error.message,
        errorStack: error.stack
      }
    : { errorMessage: String(error) };
}

export function createRunId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function logTriageDebug(event: string, metadata: DebugMetadata = {}) {
  console.info(DEBUG_PREFIX, event, sanitizeTriageMetadata(metadata));
}

export function logTriageError(event: string, error: unknown, metadata: DebugMetadata = {}) {
  console.error(
    DEBUG_PREFIX,
    event,
    sanitizeTriageMetadata({ ...metadata, ...getTriageErrorMetadata(error) })
  );
}
