# Contributing to Rondel

Thanks for helping. Bug reports, template ideas and pull requests are all welcome.

## Reporting a problem or an idea

Open an [issue](https://github.com/spikinglabs/rondel/issues/new/choose). The "Send feedback" link in the app's
footer opens one with your version filled in. Never paste a meeting link into an issue: the link is the key to
the meeting, and issues are public.

For a security problem, don't open an issue. Use
[a private report](https://github.com/spikinglabs/rondel/security/advisories/new) instead.

## Changing the code

1. Fork the repository and make a branch from `main`.
2. `npm ci`, then `npm run dev` to run the app and the room server locally.
3. Keep the change small and focused, and add or update a test for it.
4. Check it before you push:
   ```sh
   npm test            # unit tests, including the compatibility test for saved meetings
   npm run build
   npm run test:e2e    # browser tests; needs Chromium (npx playwright install chromium)
   ```
5. Open a pull request against `main` and describe what a user would notice: what happened before and what
   happens now.

Every pull request runs the same checks in GitHub Actions. A maintainer reviews and merges it; merged changes
go to the staging site first and reach the hosted site with the next release.

Things to keep in mind:

- **Meetings are end-to-end encrypted.** Nothing a person writes may reach a server, a log or an issue
  unencrypted, and the key in the link (after `#`) must never be sent anywhere.
- **Old meetings must keep opening.** If you change how a meeting, series, backup or template is stored,
  `test/compat.test.ts` will tell you. Make the new code read the old data, never the other way round, and add a
  fixture with `node --import tsx scripts/compat-fixture.ts` when a release changes storage.
- **The data page must stay true.** `src/pages/DataPage.tsx` explains in plain words what is stored where.
  Change it in the same pull request when your change affects what it says.
- **Keep it simple.** No accounts, no tracking, no scripts or fonts from other sites.

## Signing off your commits

Rondel uses the [Developer Certificate of Origin](https://developercertificate.org/) (DCO): by signing off a
commit, you state that you wrote it or otherwise have the right to submit it under the project's licence.
Add the sign-off with `git commit -s`, which appends a line like this to the commit message:

```
Signed-off-by: Your Name <you@example.com>
```

A check on every pull request makes sure each commit has one. To fix a commit you already made, run
`git commit --amend -s` (or `git rebase --signoff main` for several) and push again.

## Licence

Contributions are released under the [Apache License 2.0](LICENSE), like the rest of Rondel. "Rondel" names the
version made by Spiking Labs; see the README.
