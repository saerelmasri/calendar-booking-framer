// framer-build/ must match the code in framer/: it's what gets saved to Framer, so an
// edit in framer/ without `npm run build:framer` would reach the repo but not the site.
//
// Run with:  npm test

import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { build, COMPONENTS, outputOf, ROOT } from "../scripts/build-framer.mjs"

// Git on Windows may check files out with \r\n line endings; that's not a real difference.
const lines = (text) => text.replace(/\r\n/g, "\n")

for (const entry of COMPONENTS) {
  test(`framer-build is up to date with ${entry}`, () => {
    const target = outputOf(entry)
    assert.ok(existsSync(target), `${target} is missing: run npm run build:framer`)
    assert.ok(
      lines(readFileSync(target, "utf8")) === lines(build(join(ROOT, entry))),
      "framer-build is out of date: run npm run build:framer",
    )
  })
}
