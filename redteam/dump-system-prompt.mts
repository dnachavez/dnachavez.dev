/**
 * Snapshots the live system prompt for `assert/no-system-prompt-leak.js`, and
 * refuses to when the prompt cannot be trusted to mean what the suite assumes.
 *
 * Run from the same tsx entry point as the corpus build, because the prompt
 * imports the generated index and therefore needs the path aliases.
 *
 * The checks below are the half of the red team gate that does not need a model.
 * A version edited in the Langfuse UI can rename a heading without its marker or
 * delete a placeholder, and Mustache renders a missing variable as an empty
 * string without complaint; either would leave the tripwire or the prompt quietly
 * hollow. They run here because this is the one step every gate run passes
 * through before anything is served.
 */
import fs from "node:fs"
import path from "node:path"

import { SITE_INDEX } from "@/generated/chat-index"
import { CONTACT_EMAIL } from "@/features/chat/config"
import { loadSystemPrompt } from "@/features/chat/lib/system-prompt"

const { text, markers, source } = await loadSystemPrompt()

const label =
  source.kind === "langfuse"
    ? `langfuse v${source.version} [${source.labels.join(", ")}]`
    : source.kind

/**
 * A gate run pins the version it was dispatched for. Anything else loading
 * here, whether the repo copy because the secrets are missing or a different
 * version, would make the suite pass for a prompt it was not asked about.
 */
const pinned = process.env.LANGFUSE_PROMPT_VERSION
if (
  pinned &&
  (source.kind !== "langfuse" || String(source.version) !== pinned)
) {
  console.error(`Asked for v${pinned}, loaded ${label}.`)
  process.exit(1)
}

const missing = [
  ...markers.filter((marker) => !text.includes(marker)),
  ...(text.includes(SITE_INDEX) ? [] : ["{{site_index}}"]),
  ...(text.includes(CONTACT_EMAIL) ? [] : ["{{contact_email}}"]),
]

if (missing.length > 0) {
  console.error(
    `${label} is missing ${JSON.stringify(missing)}. A renamed heading needs ` +
      `its marker updated in config.markers in the same version.`
  )
  process.exit(1)
}

const dir = path.join(process.cwd(), "redteam")
fs.writeFileSync(path.join(dir, ".system-prompt.txt"), text, "utf8")
fs.writeFileSync(
  path.join(dir, ".system-prompt-markers.json"),
  JSON.stringify(markers),
  "utf8"
)
console.log(`Wrote the ${label} system prompt and its markers to ${dir}`)
