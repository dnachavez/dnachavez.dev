/**
 * Reports whether the current revision has been scanned.
 *
 * Runs on every push to a pull request and costs one API call, which is the
 * whole trick: the check is cheap and the scan is not, so the check reads
 * evidence rather than producing it.
 *
 * A revision with no matching evidence is reported as `neutral`. Nothing is known
 * to be wrong with it — nobody has looked — and there is a real difference
 * between "scanned, found problems" and "not scanned", which `failure` erases.
 * Reporting the second as red also trains people to merge through a red check,
 * which is how a gate stops meaning anything.
 */
import {
  CHECK_NAME,
  findEvidenceComment,
  parseEvidence,
  publishCheck,
} from "./evidence.mjs"

const { GITHUB_REPOSITORY: repo, PR: prNumber, HEAD_SHA: headSha } = process.env

if (!repo || !prNumber || !headSha) {
  console.error("GITHUB_REPOSITORY, PR and HEAD_SHA are required")
  process.exit(1)
}

const comment = await findEvidenceComment(repo, prNumber)
const evidence = comment ? parseEvidence(comment.body) : null

if (evidence?.headSha === headSha) {
  const clean = evidence.failed === 0
  await publishCheck(repo, headSha, {
    conclusion: clean ? "success" : "failure",
    title: clean
      ? `${evidence.total} cases, no critical or high findings`
      : `${evidence.failed} critical/high finding(s) across ${evidence.total} cases`,
    summary:
      `Evidence recorded for this exact revision by an earlier run — ` +
      `${evidence.suite} suite against \`${evidence.model}\`, ${evidence.ranAt}.\n\n` +
      `Re-run with \`/redteam ${headSha}\` if you want a fresh one.`,
  })

  console.log(`${CHECK_NAME}: reused evidence for ${headSha.slice(0, 7)}.`)
  process.exit(0)
}

const previous = evidence
  ? `The most recent scan covers \`${evidence.headSha.slice(0, 7)}\`, which is not this revision.`
  : "This pull request has not been scanned."

await publishCheck(repo, headSha, {
  conclusion: "neutral",
  title: "No scan for this revision",
  summary:
    `${previous}\n\n` +
    "The generated scan is a few hundred model calls, so it does not run on " +
    "every push. Ask for one when the change is ready:\n\n" +
    `- comment \`/redteam ${headSha}\` on this pull request (or \`/redteam multi-turn ${headSha}\`) once you have reviewed that commit\n` +
    "- or run it locally and publish the result:\n\n" +
    "```bash\n" +
    "pnpm redteam:scan\n" +
    "PR=<number> HEAD_SHA=$(git rev-parse HEAD) \\\n" +
    "  GITHUB_TOKEN=$(gh auth token) pnpm redteam:publish\n" +
    "```",
})

console.log(`${CHECK_NAME}: no evidence for ${headSha.slice(0, 7)}.`)
