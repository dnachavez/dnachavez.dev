import { TextPromptClient } from "@langfuse/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SITE_INDEX } from "@/generated/chat-index"

import { CONTACT_EMAIL } from "../config"
import { PROMPT_MARKERS } from "./output-tripwire"

const get = vi.fn()

vi.mock("@langfuse/client", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  LangfuseClient: class {
    prompt = { get }
  },
}))

/**
 * Re-imported per test: the client, its cache and the fallback window all live
 * at module scope, and one test's outage must not leak into the next.
 */
async function load() {
  vi.resetModules()
  return import("./system-prompt")
}

function fetched(prompt: string, version = 7, config?: unknown) {
  return new TextPromptClient({
    name: "chat-system",
    version,
    labels: ["production"],
    tags: [],
    type: "text",
    prompt,
    config,
  })
}

beforeEach(() => {
  get.mockReset()
  vi.stubEnv("LANGFUSE_PUBLIC_KEY", "")
  vi.stubEnv("LANGFUSE_SECRET_KEY", "")
  vi.stubEnv("LANGFUSE_PROMPT_VERSION", "")
  vi.stubEnv("LANGFUSE_PROMPT_LABEL", "")
  vi.stubEnv("LANGFUSE_PROMPT_STRICT", "")
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("without Langfuse keys", () => {
  it("renders the repo copy exactly as the old template literal did", async () => {
    const { CHAT_SYSTEM_TEMPLATE, loadSystemPrompt } = await load()
    const { text, markers, source } = await loadSystemPrompt()

    expect(source).toEqual({ kind: "local" })
    expect(text).toBe(
      CHAT_SYSTEM_TEMPLATE.replace("{{site_index}}", SITE_INDEX).replaceAll(
        "{{contact_email}}",
        CONTACT_EMAIL
      )
    )
    expect(text).not.toContain("{{")
    expect(markers).toEqual(PROMPT_MARKERS)
    for (const marker of PROMPT_MARKERS) expect(text).toContain(marker)
    expect(get).not.toHaveBeenCalled()
  })

  /** CI passes `""` for secrets a fork cannot see. */
  it("treats empty keys as unset", async () => {
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "")
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-lf-test")
    const { loadSystemPrompt } = await load()

    expect((await loadSystemPrompt()).source).toEqual({ kind: "local" })
  })
})

describe("with Langfuse keys", () => {
  beforeEach(() => {
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-lf-test")
    vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-lf-test")
  })

  it("compiles the fetched version and uses its markers", async () => {
    get.mockResolvedValue(
      fetched("# Rules\n{{site_index}}\n{{contact_email}}", 7, {
        markers: ["# Rules"],
      })
    )
    const { loadSystemPrompt } = await load()
    const { text, markers, source } = await loadSystemPrompt()

    expect(text).toBe(`# Rules\n${SITE_INDEX}\n${CONTACT_EMAIL}`)
    expect(markers).toEqual(["# Rules"])
    expect(source).toEqual({
      kind: "langfuse",
      version: 7,
      labels: ["production"],
    })
    expect(get).toHaveBeenCalledWith(
      "chat-system",
      expect.objectContaining({ type: "text", label: "production" })
    )
  })

  it("pins a version instead of the label when one is asked for", async () => {
    vi.stubEnv("LANGFUSE_PROMPT_VERSION", "12")
    get.mockResolvedValue(fetched("x", 12, { markers: ["x"] }))
    const { loadSystemPrompt } = await load()
    await loadSystemPrompt()

    const options = get.mock.calls[0][1]
    expect(options.version).toBe(12)
    expect(options).not.toHaveProperty("label")
  })

  it.each(["0", "-3", "1.5", "v12"])(
    "ignores a version that is not a positive integer (%s)",
    async (version) => {
      vi.stubEnv("LANGFUSE_PROMPT_VERSION", version)
      get.mockResolvedValue(fetched("x", 7, { markers: ["x"] }))
      const { loadSystemPrompt } = await load()
      await loadSystemPrompt()

      expect(get.mock.calls[0][1]).toMatchObject({ label: "production" })
      expect(get.mock.calls[0][1]).not.toHaveProperty("version")
    }
  )

  it("falls back to the default markers when a version has none", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    get.mockResolvedValue(fetched("{{site_index}}", 7, {}))
    const { loadSystemPrompt } = await load()

    expect((await loadSystemPrompt()).markers).toEqual(PROMPT_MARKERS)
    expect(error).toHaveBeenCalledOnce()
  })

  /**
   * The SDK hands back its fallback on a fetch failure but never caches it, so
   * without the window every turn during an outage would wait out the timeout.
   */
  it("serves the repo copy for a window after a fallback, fetching once", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    get.mockImplementation(async (_name, options) => {
      const prompt = fetched(options.fallback)
      return Object.assign(prompt, { isFallback: true })
    })
    const { loadSystemPrompt } = await load()

    expect((await loadSystemPrompt()).source).toEqual({ kind: "fallback" })
    expect((await loadSystemPrompt()).source).toEqual({ kind: "fallback" })
    expect(get).toHaveBeenCalledOnce()
    expect(error).toHaveBeenCalledOnce()
  })

  describe("in strict mode", () => {
    beforeEach(() => {
      vi.stubEnv("LANGFUSE_PROMPT_STRICT", "1")
    })

    it("asks for no fallback, so a failed fetch throws", async () => {
      get.mockRejectedValue(new Error("unreachable"))
      const { loadSystemPrompt } = await load()

      await expect(loadSystemPrompt()).rejects.toThrow("unreachable")
      expect(get.mock.calls[0][1].fallback).toBeUndefined()
    })

    it("rejects a version without markers", async () => {
      get.mockResolvedValue(fetched("{{site_index}}", 7, { markers: [""] }))
      const { loadSystemPrompt } = await load()

      await expect(loadSystemPrompt()).rejects.toThrow(/config\.markers/)
    })
  })
})
