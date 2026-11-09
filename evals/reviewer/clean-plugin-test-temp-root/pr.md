# test(plugin): resolve the test's temp root, so the plugin tests pass on macOS (#134) (#196)

On macOS tmpdir() is behind a symlink (/var -> /private/var). A plugin is
recorded by its real file, so two tests that compared the recorded source with
the path they wrote failed there. The test now takes the real path of its root.
Shown here by running the tests with TMPDIR behind a symlink.
