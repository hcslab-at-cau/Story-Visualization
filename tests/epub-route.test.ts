import assert from "node:assert/strict"
import test from "node:test"
import { maxDuration, POST } from "../src/app/api/epub/route.ts"

async function postForm(formData: FormData): Promise<Response> {
  return POST(new Request("http://localhost/api/epub", {
    method: "POST",
    body: formData,
  }))
}

test("EPUB route keeps the extended import timeout", () => {
  assert.equal(maxDuration, 120)
})

test("EPUB route rejects a missing file", async () => {
  const response = await postForm(new FormData())

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: "No file provided" })
})

test("EPUB route rejects a string in the file field", async () => {
  const formData = new FormData()
  formData.set("file", "not-an-epub-file")

  const response = await postForm(formData)

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: "No file provided" })
})

test("EPUB route validates bookId before initializing Firebase", async () => {
  const formData = new FormData()
  formData.set("file", new File(["not parsed"], "novel.epub", {
    type: "application/epub+zip",
  }))
  formData.set("bookId", "invalid book id")

  const response = await postForm(formData)

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), {
    error: "bookId must match ^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$",
    code: "invalid_book_id",
  })
})
