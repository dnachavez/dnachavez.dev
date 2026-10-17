import { createHmac } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { verifyLangfuseSignature } from "@/features/chat/lib/langfuse-webhook"

import { POST } from "./route"

const SECRET = "whsec-test"

function event(overrides: Record<string, unknown> = {}, prompt = {}) {
  return JSON.stringify({
    id: "evt_1",
    timestamp: "2026-10-17T12:00:00Z",
    type: "prompt-version",
    apiVersion: "v1",
    action: "created",
    prompt: {
      name: "chat-system",
      version: 8,
      labels: [],
      ...prompt,
    },
    ...overrides,
  })
}

function sign(body: string, seconds = Math.floor(Date.now() / 1000)) {
  const digest = createHmac("sha256", SECRET)
    .update(`${seconds}.${body}`)
    .digest("hex")
  return `t=${seconds},v1=${digest}`
}

function request(body: string, signature: string | null = sign(body)) {
  return new Request("http://localhost/api/langfuse-webhook", {
    method: "POST",
    body,
    headers: signature ? { "x-langfuse-signature": signature } : {},
  })
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubEnv("LANGFUSE_WEBHOOK_SECRET", SECRET)
  vi.stubEnv("GITHUB_DISPATCH_TOKEN", "github_pat_test")
  fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 204 }))
  vi.stubGlobal("fetch", fetchMock)
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("POST /api/langfuse-webhook", () => {
  it("dispatches the gate for a new version without production", async () => {
    const response = await POST(request(event()))

    expect(response.status).toBe(204)
    expect(fetchMock).toHaveBeenCalledOnce()

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/actions\/workflows\/redteam\.yml\/dispatches$/)
    expect(init.headers.Authorization).toBe("Bearer github_pat_test")
    expect(JSON.parse(init.body)).toEqual({
      ref: "main",
      inputs: { prompt_version: "8" },
    })
  })

  it.each([
    [
      "a version saved straight to production",
      event({}, { labels: ["production"] }),
    ],
    ["a label change", event({ action: "updated" })],
    ["a deletion", event({ action: "deleted" })],
    ["another prompt", event({}, { name: "something-else" })],
  ])("acknowledges %s without dispatching", async (_label, body) => {
    const response = await POST(request(body))

    expect(response.status).toBe(204)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects a body that does not match its signature", async () => {
    const body = event()
    const response = await POST(
      request(body.replace('"version":8', '"version":9'), sign(body))
    )

    expect(response.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects a missing signature", async () => {
    expect((await POST(request(event(), null))).status).toBe(401)
  })

  it("rejects a replayed delivery outside the window", async () => {
    const body = event()
    const stale = Math.floor(Date.now() / 1000) - 10 * 60

    expect((await POST(request(body, sign(body, stale)))).status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  /**
   * Langfuse retries a non-2xx, which is what keeps the version from going
   * ungated.
   */
  it("reports a failed dispatch so Langfuse retries", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 422 }))

    expect((await POST(request(event()))).status).toBe(502)
  })

  it("is off when it is not configured", async () => {
    vi.stubEnv("GITHUB_DISPATCH_TOKEN", "")

    expect((await POST(request(event()))).status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("verifyLangfuseSignature", () => {
  it("accepts a millisecond timestamp too, since the unit is undocumented", () => {
    const body = event()
    const now = Date.now()
    const digest = createHmac("sha256", SECRET)
      .update(`${now}.${body}`)
      .digest("hex")

    expect(
      verifyLangfuseSignature(body, `t=${now},v1=${digest}`, SECRET, now)
    ).toBe(true)
  })

  it("rejects a signature made with another secret", () => {
    const body = event()
    const seconds = Math.floor(Date.now() / 1000)
    const digest = createHmac("sha256", "other")
      .update(`${seconds}.${body}`)
      .digest("hex")

    expect(
      verifyLangfuseSignature(body, `t=${seconds},v1=${digest}`, SECRET)
    ).toBe(false)
  })
})
