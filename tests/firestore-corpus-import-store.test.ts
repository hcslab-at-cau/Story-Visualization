import assert from "node:assert/strict"
import test from "node:test"
import { deriveCorpusIdentity } from "../src/lib/corpus-identity.ts"
import { FirestoreCorpusImportRepository } from "../src/lib/server/firestore-corpus-import-store.ts"

test("FirestoreCorpusImportRepository does not initialize Firestore until a method runs", async () => {
  const identity = deriveCorpusIdentity(Buffer.from("canonical firestore fixture"))
  let getDbCalls = 0

  const repository = new FirestoreCorpusImportRepository({
    getDb() {
      getDbCalls += 1
      return {
        collection() {
          return {
            doc() {
              return {
                async get() {
                  return { exists: false }
                },
              }
            },
          }
        },
      } as never
    },
  })

  assert.equal(getDbCalls, 0)
  assert.equal(await repository.getRevision(identity.corpusRevisionId), null)
  assert.equal(getDbCalls, 1)
})
