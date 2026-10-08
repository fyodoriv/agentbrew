# Accessible links (PR bodies + published docs)

Links must resolve for reviewers **without** a local checkout.

| Do | Don't |
|----|-------|
| PR URL for docs on non-default branches | Raw `docs/...` paths or `~/apps/...` |
| GHE blob URLs for files on **default branch** | Org blob when branch is fork-only (404) |
| Fork blob URLs when branch not on org default | Relative links needing `git checkout` |
| Full `https://` for GDoc/Jira/Slack | Shortlinks |

**Command-center hub:** link the **draft PR**; fork blob for fork-only files. Verify with browser or `curl -I` before `gh pr create`. Record in **`LINKS.md`**.
