# Studio Workflow 정의

각 JSON 파일은 `POST /v2/agents/{agent_id}/configs`의 `steps` 배열이다.
Config는 불변이므로 파일을 수정하면 새 Config 버전으로 등록한다.

| 파일 | Agent | 단계 |
|---|---|---|
| `ingest.json` | 계약서 적재 (F1) | Parse → Extract(메타데이터) → Export(Collection) |
