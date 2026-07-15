export type FirestoreDataSource = "current" | "legacy" | "v3"
export type StorageDataSource = "current" | "v3"

export const CURRENT_DOCUMENTS_COLLECTION = "documents_v2"
export const LEGACY_DOCUMENTS_COLLECTION = "documents"
export const V3_DOCUMENTS_COLLECTION = "documents_v3"

export function firestoreDocumentsCollectionName(
  source: FirestoreDataSource = "current",
): string {
  if (source === "legacy") return LEGACY_DOCUMENTS_COLLECTION
  if (source === "v3") return V3_DOCUMENTS_COLLECTION
  return CURRENT_DOCUMENTS_COLLECTION
}

export function parseFirestoreDataSource(value: string | null | undefined): FirestoreDataSource {
  if (value === "legacy" || value === "v3") return value
  return "current"
}

export function parseStorageDataSource(value: string | null | undefined): StorageDataSource {
  return value === "v3" ? "v3" : "current"
}

export function parseRequiredV3DataSource(value: string | null | undefined): "v3" | null {
  return value === "v3" ? "v3" : null
}

export function storagePrefixForSource(source: StorageDataSource = "current"): string {
  return source === "v3" ? V3_DOCUMENTS_COLLECTION : CURRENT_DOCUMENTS_COLLECTION
}
