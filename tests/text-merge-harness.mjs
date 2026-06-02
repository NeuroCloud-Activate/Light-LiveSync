import assert from "node:assert/strict";
import { automaticTextMerge } from "../src/text-merge.ts";

assert.equal(
  automaticTextMerge("local", "remote"),
  "local\nremote",
  "unrelated single-line edits should keep local text and append incoming text"
);

assert.equal(
  automaticTextMerge("A\nC", "A\nB\nC"),
  "A\nB\nC",
  "incoming lines should be inserted between matching anchors"
);

assert.equal(
  automaticTextMerge("A\nlocal edit\nC", "A\nremote edit\nC"),
  "A\nlocal edit\nremote edit\nC",
  "local and remote edits in the same gap should both be preserved near their anchor"
);

assert.equal(
  automaticTextMerge("---\ntitle: Local\n---\nBody", "---\ntitle: Local\ntags: remote\n---\nBody\nRemote line\n"),
  "---\ntitle: Local\ntags: remote\n---\nBody\nRemote line\n",
  "frontmatter additions and body additions should stay near their surrounding lines"
);

assert.equal(
  automaticTextMerge("A\nB\nC\n", "A\nB\nC\nD\n"),
  "A\nB\nC\nD\n",
  "trailing newline should be preserved when either side has one"
);

assert.equal(
  automaticTextMerge("A\nB\nC\n", "A\nC\n"),
  "A\nC\n",
  "remote line deletions should remove text from the local copy"
);

assert.equal(
  automaticTextMerge("I can add test text here.", "I can add text here."),
  "I can add text here.",
  "remote inline deletions should remove text from the local copy"
);

console.log(JSON.stringify({
  ok: true,
  anchoredInsertion: true,
  localAndRemotePreserved: true,
  frontmatterAddition: true,
  trailingNewline: true,
  remoteLineDeletion: true,
  remoteInlineDeletion: true
}, null, 2));
