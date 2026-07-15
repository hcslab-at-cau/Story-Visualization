import assert from "node:assert/strict"
import {
  parseFirestoreDataSource,
  firestoreDocumentsCollectionName,
  storagePrefixForSource,
} from "./data-source.ts"

assert.equal(parseFirestoreDataSource("v3"), "v3")
assert.equal(firestoreDocumentsCollectionName("current"), "documents_v2")
assert.equal(firestoreDocumentsCollectionName("legacy"), "documents")
assert.equal(firestoreDocumentsCollectionName("v3"), "documents_v3")
assert.equal(storagePrefixForSource("current"), "documents_v2")
assert.equal(storagePrefixForSource("v3"), "documents_v3")
