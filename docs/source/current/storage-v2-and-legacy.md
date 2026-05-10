# 저장 구조 v2와 Legacy 데이터 접근

## 결정

기존 Firestore 컬렉션 `documents`는 이름을 바꾸지 않고 legacy 읽기 전용 데이터로 유지한다.

새 업로드와 새 pipeline 실행은 `documents_v2` 컬렉션을 사용한다. Firestore에서 컬렉션 rename이 불가능하다는 제약을 피하면서도, 기존 데이터를 삭제하거나 이전하지 않고 계속 확인할 수 있게 하기 위한 선택이다.

## 컬렉션 역할

| 컬렉션 | 역할 | 쓰기 여부 |
| --- | --- | --- |
| `documents_v2` | 현재 시스템의 기본 문서, 챕터, run, artifact 저장소 | 새 업로드/새 실행에서 사용 |
| `documents` | 이전 구현으로 저장된 기존 데이터 | legacy 화면에서 읽기 전용 |

## 새 저장 방식

v2에서는 run마다 stage artifact payload를 복사하지 않는다. 대신 run document는 각 stage가 어떤 artifact를 참조하는지 `stageRefs`만 가진다.

```ts
runs/{runId} = {
  storageVersion: 2,
  forkedFrom: "run_001",
  stageRefs: {
    pre1: "pre1_a1b2...",
    pre2: "pre2_c3d4...",
    ent1: "ent1_e5f6..."
  },
  stageModels: {
    pre2: "openai/gpt-4o-mini"
  },
  updatedAt
}
```

artifact payload는 chapter 아래의 공유 artifact collection에 한 번만 저장한다.

```ts
documents_v2/{docId}/chapters/{chapterId}/artifacts/{artifactId} = {
  artifactId,
  stageKey,
  stageId,
  docId,
  chapterId,
  payload,
  updatedAt
}
```

## Fork 방식

기존 방식은 fork할 때 보존할 stage artifact payload를 새 run 아래로 복사했다. v2에서는 payload를 복사하지 않고 `stageRefs`만 복사한다.

예를 들어 `STATE.2`를 다시 실행하면 새 run은 `PRE.1`부터 `STATE.1`까지 기존 artifact id를 그대로 참조하고, `STATE.2` 이후만 새 artifact를 만든다.

이 방식은 다음 장점이 있다.

- 같은 stage 결과가 여러 run에 반복 저장되지 않는다.
- run은 여전히 “이 실행이 어떤 결과들의 조합인지”를 명확히 가진다.
- 중간 단계 재실행 시 이전 run을 오염시키지 않는다.
- `parents`가 artifact id를 가리키므로 실행 계보를 추적할 수 있다.

## Legacy 접근

앱 상단의 `legacy` 탭은 기존 `documents` 컬렉션을 읽는다. 이 화면은 이전 데이터 확인 전용이며, 새 실행이나 삭제를 제공하지 않는다.

API route는 `source=legacy` query를 받으면 `documents`를 읽고, 기본값은 `documents_v2`를 읽는다.

예시:

```txt
/api/documents
/api/documents?source=legacy
/api/chapters?docId=...&source=legacy
/api/runs?docId=...&chapterId=...&source=legacy
/api/stage-result?docId=...&chapterId=...&runId=...&stageKey=final1&source=legacy
```

## 주의점

기존 `documents` 데이터는 자동으로 v2로 migration하지 않는다. 필요한 경우 legacy run을 열어 확인하고, 이후 새 실험은 `documents_v2`에서 다시 실행한다.

새 artifact에는 저장 시 `artifact_id`가 추가된다. `parents`는 stage id에서 parent artifact id로 이어지는 map이다.
