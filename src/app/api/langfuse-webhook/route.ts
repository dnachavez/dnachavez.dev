import { CHAT_PROMPT_NAME } from "@/features/chat/config"
import {
  decideDispatch,
  GATE_WORKFLOW_URL,
  verifyLangfuseSignature,
} from "@/features/chat/lib/langfuse-webhook"

/**
 * Relays new prompt versions from Langfuse to the red team gate, which a
 * Langfuse webhook cannot start directly: GitHub wants its own body shape and a
 * bearer token, and Langfuse sends neither.
 */
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const secret = process.env.LANGFUSE_WEBHOOK_SECRET
  const token = process.env.GITHUB_DISPATCH_TOKEN

  /**
   * Unconfigured means the feature is off, and an endpoint that is off says
   * nothing about itself.
   */
  if (!secret || !token) {
    return new Response(null, { status: 404 })
  }

  /** Verified against the bytes as sent; re-serialised JSON would not match. */
  const rawBody = await request.text()
  if (
    !verifyLangfuseSignature(
      rawBody,
      request.headers.get("x-langfuse-signature"),
      secret
    )
  ) {
    return new Response(null, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new Response(null, { status: 400 })
  }

  /** Answered 2xx so Langfuse stops retrying an event that will never qualify. */
  const decision = decideDispatch(payload, CHAT_PROMPT_NAME)
  if (!decision.dispatch) {
    return new Response(null, { status: 204 })
  }

  const response = await fetch(GATE_WORKFLOW_URL, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      ref: "main",
      inputs: { prompt_version: String(decision.version) },
    }),
  })

  if (!response.ok) {
    /**
     * A non-2xx makes Langfuse retry, which is the point: without a gate run the
     * version never reaches production.
     */
    console.error("[langfuse-webhook] dispatch failed", {
      version: decision.version,
      status: response.status,
    })
    return new Response(null, { status: 502 })
  }

  return new Response(null, { status: 204 })
}
