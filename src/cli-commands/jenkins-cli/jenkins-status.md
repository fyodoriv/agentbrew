---
description: Check Jenkins build status for a job or the current repo's pipeline
---

# Jenkins Build Status

Check the status of Jenkins builds. Uses the Jenkins REST API via curl.

## Prerequisites

- `JENKINS_URL` — Your Jenkins server URL (e.g., `https://jenkins.example.com`)
- `JENKINS_USER` — Your Jenkins username
- `JENKINS_API_TOKEN` — Your Jenkins API token

## Steps

1. Determine the job name. If the user specified one, use it. Otherwise, derive it from the current git repo name:

```bash
git rev-parse --show-toplevel 2>/dev/null | xargs basename
```

2. Get the latest build status:

// turbo
```bash
curl -s -u "$JENKINS_USER:$JENKINS_API_TOKEN" \
  "$JENKINS_URL/job/${JOB_NAME}/lastBuild/api/json?tree=result,number,timestamp,duration,displayName,building" \
  | python3 -m json.tool
```

3. If the build is failing, get the console output tail:

```bash
curl -s -u "$JENKINS_USER:$JENKINS_API_TOKEN" \
  "$JENKINS_URL/job/${JOB_NAME}/lastBuild/consoleText" \
  | tail -100
```

4. Summarize the build status clearly:
   - **Building**: show progress
   - **Success**: show build number and duration
   - **Failure**: show the relevant error from console output
