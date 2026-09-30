---
description: Fetch and analyze Jenkins build logs for a specific build or the latest
---

# Jenkins Build Log

Fetch Jenkins build console output and analyze it for errors.

## Prerequisites

- `JENKINS_URL` — Your Jenkins server URL (e.g., `https://jenkins.example.com`)
- `JENKINS_USER` — Your Jenkins username
- `JENKINS_API_TOKEN` — Your Jenkins API token

## Steps

1. Determine the job name and build number. If not specified, use the latest build:

```bash
git rev-parse --show-toplevel 2>/dev/null | xargs basename
```

2. Fetch the console log:

// turbo
```bash
curl -s -u "$JENKINS_USER:$JENKINS_API_TOKEN" \
  "$JENKINS_URL/job/${JOB_NAME}/${BUILD_NUMBER:-lastBuild}/consoleText"
```

3. If the log is very long, focus on the relevant sections:
   - Search for `ERROR`, `FAILURE`, `Exception`, `FATAL`
   - Show the 20 lines before and after each match
   - Summarize the root cause

4. Present findings:
   - **If failed**: explain the root cause and suggest a fix
   - **If succeeded**: confirm success and show key metrics (duration, test results)
