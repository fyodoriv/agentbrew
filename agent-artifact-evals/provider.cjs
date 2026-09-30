const fs = require("node:fs");
const path = require("node:path");

const PLAIN_LANGUAGE_RULES = [
  {
    id: "plain-language-output",
    message: "missing plain-language output default",
    patterns: [
      /ASD-STE100-style plain\s+English/i,
      /Always write agent-authored natural-language\s+text for an ADHD audience/i,
      /This rule is always active/i,
      /A user request for\s+another style does not override it/i,
      /short paragraphs/i,
      /short, direct sentences[\s\S]*active[\s\S]*voice/i,
      /one idea per sentence or bullet/i,
      /headings, bullets,\s+or numbered\s+steps[\s\S]*scanning/i,
    ],
  },
  {
    id: "plain-language-code-comments",
    message: "missing plain-language code-comment scope",
    patterns: [/code\s+comments/i],
  },
];

const AGENTS_RULES = [
  {
    id: "publish-approval",
    message: "missing explicit approval language",
    patterns: [/explicit approval/i, /publish/i, /outside the current repo|cross-workspace/i],
  },
  {
    id: "public-impersonation",
    message: "missing public impersonation ban",
    patterns: [/Never publish under the user's identity/i, /exact action in the current session/i],
  },
  {
    id: "force-push",
    message: "missing unsafe git publication guardrails",
    patterns: [/force-push|force-pushing/i, /protected-branch|protected branches|deleting remote branches/i],
  },
  {
    id: "destructive-confirmation",
    message: "missing destructive operation confirmation",
    patterns: [/destructive operations?/i, /explicit confirmation/i],
  },
  {
    id: "standing-approvals",
    message: "missing standing approval boundaries",
    patterns: [/Standing approvals?/i, /current-repo work/i],
  },
  ...PLAIN_LANGUAGE_RULES,
];

const COMMAND_RULES = {
  "src/cli-commands/storybook-screenshot/storybook-screenshot.md": [
    {
      id: "storybook-command",
      message: "missing storybook-screenshot command invocation",
      patterns: [/storybook-screenshot/i, /```bash/i],
    },
    {
      id: "storybook-verify",
      message: "missing visual verification guidance",
      patterns: [/inspect the images/i, /before making visual claims/i],
    },
  ],
  "src/cli-commands/jenkins-cli/jenkins-status.md": [
    {
      id: "jenkins-credentials",
      message: "missing Jenkins credential prerequisites",
      patterns: [/JENKINS_URL/i, /JENKINS_USER/i, /JENKINS_API_TOKEN/i],
    },
    {
      id: "jenkins-log-followup",
      message: "missing failure log follow-up",
      patterns: [/console output|consoleText/i, /If the build is failing|Failure/i],
    },
  ],
  "src/cli-commands/jenkins-cli/jenkins-log.md": [
    {
      id: "jenkins-log-fetch",
      message: "missing Jenkins log fetch command",
      patterns: [/consoleText/i, /curl/i],
    },
    {
      id: "jenkins-root-cause",
      message: "missing root-cause summary guidance",
      patterns: [/root cause/i, /ERROR|FAILURE|Exception|FATAL/i],
    },
  ],
};

function evaluateArtifactText({ artifactPath, text }) {
  const diagnostics = diagnosticsForArtifact(artifactPath, text);
  const status = diagnostics.length === 0 ? "PASS" : "FAIL";
  const lines = [`${status} ${artifactPath}`, `diagnostic_count=${diagnostics.length}`];
  for (const diagnostic of diagnostics) {
    lines.push(`diagnostic ${diagnostic.id} ${diagnostic.message}`);
  }
  return { output: lines.join("\n") };
}

async function callApi(_prompt, _options, context) {
  const vars = context?.vars ? context.vars : {};
  const artifactPath = String(vars.artifact_path || vars.artifact || "unknown-artifact");
  const fixtureText = typeof vars.fixture_text === "string" ? vars.fixture_text : undefined;
  const text = fixtureText === undefined ? readArtifact(artifactPath) : fixtureText;
  return evaluateArtifactText({ artifactPath, text });
}

class AgentArtifactProvider {
  id() {
    return "deterministic-artifact-provider";
  }

  async callApi(prompt, context) {
    return callApi(prompt, undefined, context);
  }
}

function diagnosticsForArtifact(artifactPath, text) {
  const rules = rulesForArtifact(artifactPath);
  return rules.flatMap((rule) => (rule.patterns.every((pattern) => pattern.test(text)) ? [] : [rule]));
}

function rulesForArtifact(artifactPath) {
  if (artifactPath === "templates/AGENTS.md" || artifactPath.includes("agents-fixture")) return AGENTS_RULES;
  if (artifactPath === "docs/shared-rules.md" || artifactPath.includes("shared-rules-fixture")) {
    return PLAIN_LANGUAGE_RULES;
  }
  return COMMAND_RULES[artifactPath] || [];
}

function readArtifact(artifactPath) {
  const repoRoot = path.resolve(__dirname, "..");
  const fullPath = path.resolve(repoRoot, artifactPath);
  if (!fullPath.startsWith(repoRoot + path.sep)) {
    throw new Error(`artifact_path escapes repo root: ${artifactPath}`);
  }
  return fs.readFileSync(fullPath, "utf-8");
}

module.exports = AgentArtifactProvider;
module.exports.callApi = callApi;
module.exports.evaluateArtifactText = evaluateArtifactText;
