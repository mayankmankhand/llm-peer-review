## How to Review

<procedure>

1. **Run `npm audit --json`** in the folder that holds the lockfile (`--prefix .claude/scripts` for the toolkit's quarantined runtime deps, which every install has; the project root for the project's own dependencies; both when both exist) and categorize findings by severity (critical, high, moderate, low). If the project has no lockfile, note that as a finding - audits require one.

2. **Run `npm outdated --json`** and flag packages where the installed version is more than one major version behind, or where the latest version includes security fixes.

3. **Check maintainer activity** for any dependency with high or critical vulnerabilities. Use `gh api` to check (this stays `gh` on every host, including GitLab projects - it queries the GitHub repos of the npm dependencies themselves, not the host this project is on, so it is deliberate and not a `glab` port that was missed):
   - Last commit date (stale if no commits in 12+ months)
   - Number of contributors (single-maintainer risk if fewer than 3)
   - Star count (low adoption signal if under 100 stars)
   - Open issues vs. closed issues ratio

4. **Review license types** in package.json dependencies. Flag:
   - Copyleft licenses (GPL, AGPL) in a project that expects permissive licensing
   - Missing license fields
   - `UNLICENSED` packages

5. **Compile findings** using the standard severity and output format below. Group findings by category: Vulnerabilities, Outdated Packages, Supply Chain Risks, License Issues.

</procedure>
