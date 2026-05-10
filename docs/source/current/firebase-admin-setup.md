# Firebase Admin 설정

## 문제 원인

기존 구현은 Next.js API route 안에서도 Firebase client SDK를 사용했다. 이 방식은 브라우저에서 접근하는 것과 같은 권한으로 Firestore/Storage에 접근하므로, Firebase 보안 규칙이 `list`, `get`, `write`를 막으면 `/api/documents` 같은 서버 API도 `permission-denied`로 실패한다.

이번 수정에서는 서버 API route의 Firestore/Storage 접근을 Firebase Admin SDK로 전환했다.

관련 코드:

- `src/lib/firebase-admin.ts`
- `src/lib/firestore.ts`
- `src/lib/storage.ts`
- `src/lib/client-data.ts`

## 필요한 환경변수

로컬 또는 배포 환경에는 서버 전용 서비스 계정 정보가 필요하다. 다음 중 하나를 설정하면 된다.

### 방식 0. 서비스 계정 JSON 파일 경로 사용

로컬 개발에서는 이 방식이 가장 단순하다.

```bash
FIREBASE_SERVICE_ACCOUNT_PATH="C:/path/to/service-account.json"
```

Windows 경로는 역슬래시 대신 슬래시를 쓰는 편이 안전하다.

### 방식 1. JSON 전체를 환경변수로 저장

```bash
FIREBASE_SERVICE_ACCOUNT_JSON='{"project_id":"...","client_email":"...","private_key":"-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n"}'
```

### 방식 2. JSON을 base64로 인코딩해서 저장

```bash
FIREBASE_SERVICE_ACCOUNT_BASE64="..."
```

### 방식 3. 필드를 나눠서 저장

```bash
FIREBASE_PROJECT_ID="story-visualization-cb0e2"
FIREBASE_CLIENT_EMAIL="..."
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n"
```

### 방식 4. Google Application Default Credentials 사용

로컬에서 `gcloud auth application-default login` 또는 서비스 계정 ADC를 설정하면 Admin SDK가 이를 사용할 수 있다.

## 클라이언트 접근 방식 변경

브라우저 컴포넌트는 이제 Firestore SDK를 직접 호출하지 않는다. 대신 다음 API wrapper를 사용한다.

- `src/lib/client-data.ts`

이 wrapper는 run 목록, run 결과, stage 결과, favorite, 삭제, fork, model 저장을 모두 API route로 보낸다.

## 확인 방법

환경변수를 설정한 뒤 개발 서버를 다시 시작하고 다음 API를 확인한다.

```bash
GET /api/documents
```

정상이라면 다음 형태가 반환된다.

```json
{
  "documents": []
}
```

문제가 있으면 서비스 계정 설정 오류 메시지가 반환된다.
