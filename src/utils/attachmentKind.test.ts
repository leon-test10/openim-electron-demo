const assert = require("node:assert/strict");

const { inferAttachmentKind } = require("./attachmentKind");

assert.equal(inferAttachmentKind("photo.png"), "image");
assert.equal(inferAttachmentKind("PHOTO.JPG"), "image");
assert.equal(inferAttachmentKind("preview.webp"), "image");
assert.equal(inferAttachmentKind("render.bin", "image/png"), "image");
assert.equal(inferAttachmentKind("notes.md"), "file");
assert.equal(inferAttachmentKind("archive.zip", "application/zip"), "file");

console.log("attachmentKind tests passed");

export {};
