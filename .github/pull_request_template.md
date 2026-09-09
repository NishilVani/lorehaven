## What this changes, and why

<!-- The why matters more than the what -- the diff already says what. -->

## Checks

- [ ] `npm run lint` reports zero errors
- [ ] `npm test` passes
- [ ] `npm run build` succeeds
- [ ] No emoji anywhere, including this description and the commit messages

## If you added or changed a test

- [ ] I broke the code it covers and watched the test fail, then put the code back

<!-- A test that passes against a broken implementation is worse than no test.
     If that check does not apply here, delete this section. -->

## If you touched sync, rules, or a workflow

- [ ] I did not change `COMPAT_LEVEL` (raising it stops every older client syncing -- see CONTRIBUTING.md)
- [ ] Any Firestore rules change keeps `allow delete` separate from `create, update` (a delete carries no `request.resource`)

<!-- On a fork PR the "Deploy web" check is skipped: it needs a deploy
     credential, and GitHub does not give secrets to forks. That is expected.
     "CI" is the check that judges your change. -->
