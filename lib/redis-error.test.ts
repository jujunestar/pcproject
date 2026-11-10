import { afterEach, describe, expect, it, vi } from "vitest";
import { logRedisFailure } from "./redis-error";

describe("logRedisFailure", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.NEWKV_KV_REST_API_TOKEN;
    delete process.env.NEWKV_KV_REST_API_URL;
  });

  it("logs a useful error while redacting Redis credentials and URLs", () => {
    const token = "secret-redis-token";
    process.env.NEWKV_KV_REST_API_TOKEN = token;
    process.env.NEWKV_KV_REST_API_URL = "https://redis.example.test/rest";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    logRedisFailure(
      "POST /api/data",
      new Error(`Unauthorized ${token} at https://redis.example.test/rest`),
    );

    const loggedMessage = consoleError.mock.calls[0].join(" ");
    expect(loggedMessage).toContain("POST /api/data");
    expect(loggedMessage).toContain("Unauthorized");
    expect(loggedMessage).not.toContain(token);
    expect(loggedMessage).not.toContain("redis.example.test");
  });
});
