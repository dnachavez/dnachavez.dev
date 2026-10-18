import { createHmac, timingSafeEqual } from "node:crypto"

/**
 * Where a new prompt version is sent to be tested before it can serve traffic.
 *
 * `workflow_dispatch` rather than `repository_dispatch` for the token it needs:
 * Actions: write can start a workflow and do nothing else, where Contents: write
 * could push to this public repository from a key held in Vercel.
 */
export const GATE_WORKFLOW_URL =
  "https://api.github.com/repos/dnachavez/dnachavez.dev/actions/workflows/redteam.yml/dispatches"

/**
 * Five minutes either side. Langfuse documents the signed timestamp but no
 * window for it; this one is local policy, wide enough for its retries.
 */
const TOLERANCE_MS = 5 * 60_000

/**
 * `x-langfuse-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`.
 * https://langfuse.com/docs/prompt-management/features/webhooks-slack-integrations
 */
export function verifyLangfuseSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowMs = Date.now()
) {
  if (!header) return false

  const fields = new Map(
    header.split(",").map((field) => {
      const [key, ...rest] = field.trim().split("=")
      return [key, rest.join("=")] as const
    })
  )
  const timestamp = fields.get("t")
  const signature = fields.get("v1")
  if (!timestamp || !signature) return false

  /** The docs' example is in seconds, but no unit is stated; accept either. */
  const value = Number(timestamp)
  if (!Number.isFinite(value)) return false
  const sentMs = value > 1e12 ? value : value * 1000
  if (Math.abs(nowMs - sentMs) > TOLERANCE_MS) return false

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest()
  const received = Buffer.from(signature, "hex")

  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  )
}

export type DispatchDecision =
  | { dispatch: true; version: number }
  | { dispatch: false; reason: string }

/**
 * Every new version without `production` is a candidate. The Langfuse UI can set
 * no other label when saving, so a convention like a `candidate` label would
 * leave versions saved there ungated.
 *
 * `created` only. Promotion itself fires `updated` events, and gating those
 * would loop; a retried `created` delivery is harmless, because promotion only
 * ever moves forward.
 */
export function decideDispatch(
  payload: unknown,
  promptName: string
): DispatchDecision {
  const event = payload as {
    type?: unknown
    action?: unknown
    prompt?: { name?: unknown; version?: unknown; labels?: unknown }
  } | null

  if (event?.type !== "prompt-version") {
    return { dispatch: false, reason: "not a prompt-version event" }
  }
  if (event.action !== "created") {
    return { dispatch: false, reason: `action ${String(event.action)}` }
  }
  if (event.prompt?.name !== promptName) {
    return { dispatch: false, reason: "a different prompt" }
  }

  const { version, labels } = event.prompt
  if (typeof version !== "number" || !Number.isInteger(version)) {
    return { dispatch: false, reason: "no version" }
  }
  if (Array.isArray(labels) && labels.includes("production")) {
    return { dispatch: false, reason: "already production" }
  }

  return { dispatch: true, version }
}
