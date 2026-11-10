const REDIS_CREDENTIAL_ENV_NAMES = [
  "NEWKV_KV_REST_API_URL",
  "NEWKV_KV_REST_API_TOKEN",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
] as const;

function sanitizeRedisErrorMessage(message: string): string {
  let sanitized = message;

  for (const name of REDIS_CREDENTIAL_ENV_NAMES) {
    const secret = process.env[name];
    if (secret) {
      sanitized = sanitized.split(secret).join("[REDACTED]");
    }
  }

  return sanitized
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/https?:\/\/\S+/gi, "[REDACTED_URL]")
    .replace(/((?:token|password|authorization)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]");
}

export function logRedisFailure(operation: string, error: unknown): void {
  const errorName = error instanceof Error ? error.name : "UnknownError";
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(`[Redis] ${operation} failed (${errorName}): ${sanitizeRedisErrorMessage(errorMessage)}`);
}
