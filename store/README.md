# Microsoft Store submission state

`package.json` in this directory is the Partner Center submission document for
the MSI/EXE listing. It is **not** an npm manifest.

It does not exist yet. Create it once, from the real submission rather than from
a guess: run the **Store — fetch base submission** workflow from the Actions tab,
copy the JSON it prints, and commit it here.

After that, [store-submission.yml](../.github/workflows/store-submission.yml)
rewrites its `packageUrl` on every published release and pushes the update to
Partner Center. Everything else in the file — installer parameters, languages,
architectures — stays exactly as Partner Center accepted it.

See [docs/MICROSOFT-STORE.md](../docs/MICROSOFT-STORE.md).
