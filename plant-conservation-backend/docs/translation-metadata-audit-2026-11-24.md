# Read-only translation metadata audit - 24 November 2026

## Connection and safety

- Database: `postgres`; schema: `plant_app`; search path: `plant_app, pg_catalog`.
- The database audit ran in a PostgreSQL READ ONLY transaction and was rolled back. No database rows, cache entries, or schema were changed.
- This report omits source prose. Hashes are SHA-256 over the exact stored UTF-8 string, using the backend canonical algorithm.

## Summary

There are **46 non-empty allowlisted fields**: 9 species descriptions, 9 species habitats, 16 observation morphology values, 1 observation notes value, and 11 review comments. No cultural-significance value is non-empty.

- Existing source-language metadata: **2**; both are species 27 English metadata and both current hashes match.
- Current values missing metadata: **44**. Hash-mismatched metadata for current fields: **0**. Orphan metadata: **0**.
- Existing Malay/Chinese source-language metadata: **0**.
- Translation cache: **4 rows**, 2 for `ms` and 2 for `zh-CN`; all four hashes match species 27 description/habitat. No other audited field has a matching locale cache row. Runtime cache serving also applies protected-value validation.

| Record field | Values | Verified en | Verified ms | Verified zh-CN | Missing | Stale | Current-hash ms cache | Current-hash zh-CN cache |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| observation.morphology | 16 | 0 | 0 | 0 | 16 | 0 | 0 | 0 |
| observation.notes | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0 |
| review-comment.comment | 11 | 0 | 0 | 0 | 11 | 0 | 0 | 0 |
| species.description | 9 | 1 | 0 | 0 | 8 | 0 | 1 | 1 |
| species.habitat | 9 | 1 | 0 | 0 | 8 | 0 | 1 | 1 |

## Language assessment and proposed repair

A lexical triage marked **30** missing fields as English-likely (14 species fields and 16 observation fields). This is a candidate queue, not authoritative language identification. The other **14** missing fields are short/technical or uncertain: 11 review comments, 1 observation note, and 2 species habitat fields. Leave those unchanged until a person confirms their language.

The only safely verified English entries currently are the two already-matching species 27 metadata rows. Do not treat the lexical candidates below as confirmed until their source text is reviewed. If confirmed, propose inserts (not updates) for these exact record/field/hash tuples with source locale `en`; re-read and recompute the hash immediately before each write, and use parameterized SQL with `ON CONFLICT DO NOTHING`. No metadata write has been performed.

| record_type | record_id | field_name | proposed source_locale | current source SHA-256 |
|---|---|---|---|---|
| observation | 139c19a6-a967-498a-9399-8b638da2744a | morphology | en | 8af6a0b180373c8246d4276c1728704dcfe1bf6d370c98d08984c291b682c167 |
| observation | 17e4efa2-5708-413c-b7a0-e2cf16ec4485 | morphology | en | e37ecd40eab4c6faac5e4608ea05545dea81b22305a39efde1541ed1fe69b0af |
| observation | 18e9bfb5-f2ae-4990-bffc-6b8a137d418d | morphology | en | e283e49a4bff5dcb07cc00e5ef01aa05a43a0d217d2888d9469e56872749d905 |
| observation | 23bfd755-fc56-4f9c-9e33-8582cfac665c | morphology | en | e247b4b707934a1ef294530d7c06e9d0333a091284ad9ed83b1e8b1ea02143e0 |
| observation | 275b6d51-d62d-4b89-815a-7f0a1740564f | morphology | en | 61462e84d4522416aa530feb5abac877356579ef11729771b478818dcb8c9583 |
| observation | 51741d0f-6f09-44d4-a31c-c557bb9b2177 | morphology | en | 5635824ecc35b829f88a073f95f477e861ef2e0a58565128109dc5a2e11a7764 |
| observation | 64c118c9-07d6-46d0-934f-5d053241bd43 | morphology | en | 7326a3a6989b84c5e7f720af37ffb097d8e2df3841caceb39d2dc8281edd4a81 |
| observation | 72183b6e-15d3-4be9-9a55-fc9bb3a0d412 | morphology | en | 0f87824b439aabe6913abc8e02223bbd2293f0afe11ef9e4c32081a9e69a918b |
| observation | 99aa7f59-469f-466b-b037-8e76d3eabda5 | morphology | en | 13c87e5b71a7a64091096e234d29ff1705179e648eae975a3962a7fb8a578c9c |
| observation | a9f86bbd-e427-4356-8a27-8f2eb216a641 | morphology | en | 4d6f1493e388eb641f9135e159e1bd585c488ded0b3f4997c402b120c4496780 |
| observation | b289fb01-ba28-4d91-b054-0d30d4fdab7f | morphology | en | a294c63a121e8936381671bec106a2a7f39c1d72db1fba0cd799904e656c6ea0 |
| observation | b2b978ae-a92e-4bd0-b8af-5912f4725792 | morphology | en | 4c343edd7a108d35ff01337480c71450e35e445b9652f434b7d2438e7ebb140e |
| observation | b4451618-300b-42bc-bc08-cad6e716ce5e | morphology | en | 16f9d0ca13ea4d4a198741967bf8d1850952247ab68c2376f3da635fdb008a23 |
| observation | b9b3a9ec-9ff9-4482-8733-92b642d67284 | morphology | en | 16f9d0ca13ea4d4a198741967bf8d1850952247ab68c2376f3da635fdb008a23 |
| observation | bacb0c89-e50d-402f-83ce-eb485f0a6a05 | morphology | en | 85743b4608efc33ca3a8ae479dde814a9824500c8aa49388e2bb4b1769095384 |
| observation | f77eae42-e240-49db-b6c2-b13e66d7e390 | morphology | en | 1d6c8dad47519275ec7ca09b00d771b403819a3cb01ee2c5c5c7704d6a0fed25 |
| species | 25 | description | en | ab67e0c99ec308c5c13ea2fcfd191ec80b0d15b2fe522576d24f813121500133 |
| species | 25 | habitat | en | 0febf48cb22e79f8316b7322150f720ecb97a8292cedb540fccc96a6babc3084 |
| species | 26 | description | en | b860afc24c4996173bb3f02326b1c193abc4ad91d997044587290dabf0288424 |
| species | 26 | habitat | en | 465aea2c776fefb90621a45968bf5031bbd8521745b4ec9ff0ae90f387ea5a58 |
| species | 28 | description | en | ceb8f0064d9fd06b66ce83801b67f39801e96d5dfba878ebccae34c295efe10e |
| species | 29 | description | en | 2d20be713459c0681445eaab9dc21fd0a181f4be21b7e5b759cadd5c63a1f4a2 |
| species | 29 | habitat | en | 51eb2d8b4613ecfec58d83e3be01730395585d3e0416db728a9a5c5da6364b66 |
| species | 30 | description | en | 08e694542030f980f987b7c4a854d0006f5234ff737e4dd9dea4aed0d60d9fe1 |
| species | 31 | description | en | 418cc6cb967abe8989dbed6991a9883ddea85353c4c6a8c671e2b621d8876b7b |
| species | 31 | habitat | en | 29c8b9747ad0672e3021eef0c752b5ab6390dfa04bf692a9e2546bdca87b7017 |
| species | 32 | description | en | 0eef366d386f60ba1ed049209cac9e72df09da90cf35ceb62c26f5391fbb5cc4 |
| species | 32 | habitat | en | 98faf2968ec615d87cc17f1f897c64b6ea8152c0c5c85bab7fdec33e43759f3a |
| species | 33 | description | en | f76833325783fc05748ea1d5fdfe1c5aa73159059233604321fc02eb6c9b19d6 |
| species | 33 | habitat | en | 6c7f757c48f91e2ca1c55a8e7c3f422fc41ffb2f149cc9839588000cd3721f42 |

## Complete inventory - IDs and hashes only

| record_type | record_id | field_name | current source SHA-256 | language triage | matching ms cache | matching zh-CN cache |
|---|---|---|---|---|---|---|
| observation | 139c19a6-a967-498a-9399-8b638da2744a | morphology | 8af6a0b180373c8246d4276c1728704dcfe1bf6d370c98d08984c291b682c167 | English-likely; manual confirmation required | - | - |
| observation | 17e4efa2-5708-413c-b7a0-e2cf16ec4485 | morphology | e37ecd40eab4c6faac5e4608ea05545dea81b22305a39efde1541ed1fe69b0af | English-likely; manual confirmation required | - | - |
| observation | 18e9bfb5-f2ae-4990-bffc-6b8a137d418d | morphology | e283e49a4bff5dcb07cc00e5ef01aa05a43a0d217d2888d9469e56872749d905 | English-likely; manual confirmation required | - | - |
| observation | 23bfd755-fc56-4f9c-9e33-8582cfac665c | morphology | e247b4b707934a1ef294530d7c06e9d0333a091284ad9ed83b1e8b1ea02143e0 | English-likely; manual confirmation required | - | - |
| observation | 275b6d51-d62d-4b89-815a-7f0a1740564f | morphology | 61462e84d4522416aa530feb5abac877356579ef11729771b478818dcb8c9583 | English-likely; manual confirmation required | - | - |
| observation | 51741d0f-6f09-44d4-a31c-c557bb9b2177 | morphology | 5635824ecc35b829f88a073f95f477e861ef2e0a58565128109dc5a2e11a7764 | English-likely; manual confirmation required | - | - |
| observation | 64c118c9-07d6-46d0-934f-5d053241bd43 | morphology | 7326a3a6989b84c5e7f720af37ffb097d8e2df3841caceb39d2dc8281edd4a81 | English-likely; manual confirmation required | - | - |
| observation | 72183b6e-15d3-4be9-9a55-fc9bb3a0d412 | morphology | 0f87824b439aabe6913abc8e02223bbd2293f0afe11ef9e4c32081a9e69a918b | English-likely; manual confirmation required | - | - |
| observation | 99aa7f59-469f-466b-b037-8e76d3eabda5 | morphology | 13c87e5b71a7a64091096e234d29ff1705179e648eae975a3962a7fb8a578c9c | English-likely; manual confirmation required | - | - |
| observation | a9f86bbd-e427-4356-8a27-8f2eb216a641 | morphology | 4d6f1493e388eb641f9135e159e1bd585c488ded0b3f4997c402b120c4496780 | English-likely; manual confirmation required | - | - |
| observation | b289fb01-ba28-4d91-b054-0d30d4fdab7f | morphology | a294c63a121e8936381671bec106a2a7f39c1d72db1fba0cd799904e656c6ea0 | English-likely; manual confirmation required | - | - |
| observation | b2b978ae-a92e-4bd0-b8af-5912f4725792 | morphology | 4c343edd7a108d35ff01337480c71450e35e445b9652f434b7d2438e7ebb140e | English-likely; manual confirmation required | - | - |
| observation | b4451618-300b-42bc-bc08-cad6e716ce5e | morphology | 16f9d0ca13ea4d4a198741967bf8d1850952247ab68c2376f3da635fdb008a23 | English-likely; manual confirmation required | - | - |
| observation | b4451618-300b-42bc-bc08-cad6e716ce5e | notes | 9242b7c1c2264ac9ea066e03d151b71fb6e2053e666d95e5c81edaf6dd432461 | short or technical; manual confirmation required | - | - |
| observation | b9b3a9ec-9ff9-4482-8733-92b642d67284 | morphology | 16f9d0ca13ea4d4a198741967bf8d1850952247ab68c2376f3da635fdb008a23 | English-likely; manual confirmation required | - | - |
| observation | bacb0c89-e50d-402f-83ce-eb485f0a6a05 | morphology | 85743b4608efc33ca3a8ae479dde814a9824500c8aa49388e2bb4b1769095384 | English-likely; manual confirmation required | - | - |
| observation | f77eae42-e240-49db-b6c2-b13e66d7e390 | morphology | 1d6c8dad47519275ec7ca09b00d771b403819a3cb01ee2c5c5c7704d6a0fed25 | English-likely; manual confirmation required | - | - |
| review-comment | 3ad33fbd-933a-41c2-a0e0-1900a0f26eba | comment | 1c34f88707b55e6104c4eb20e71ffa3d33e414b71ef689a15fad0640d0ac58cb | short or technical; manual confirmation required | - | - |
| review-comment | 47141623-ee44-4e88-9347-3694ca515110 | comment | 1c34f88707b55e6104c4eb20e71ffa3d33e414b71ef689a15fad0640d0ac58cb | short or technical; manual confirmation required | - | - |
| review-comment | 6a6e0cba-8c78-4081-a6e6-1fa8c50392f8 | comment | bfa7409f764695d313199f04b1fdad43a8cecff0f549997702e0352fbc92b3b2 | short or technical; manual confirmation required | - | - |
| review-comment | 703ed3eb-f054-45b3-b847-be6c88ca8ec9 | comment | bfa7409f764695d313199f04b1fdad43a8cecff0f549997702e0352fbc92b3b2 | short or technical; manual confirmation required | - | - |
| review-comment | 733bcf75-37f6-461e-b33d-43ab07adc5ab | comment | 1c34f88707b55e6104c4eb20e71ffa3d33e414b71ef689a15fad0640d0ac58cb | short or technical; manual confirmation required | - | - |
| review-comment | 7eccd482-b57f-4efa-be0f-abad99615de8 | comment | 6e7b7d464a646d13f531081af61f2f76e3c019d099534af7db40df5d06bbbad2 | short or technical; manual confirmation required | - | - |
| review-comment | 97ce2510-8f5b-4044-a065-cb6238247924 | comment | bfa7409f764695d313199f04b1fdad43a8cecff0f549997702e0352fbc92b3b2 | short or technical; manual confirmation required | - | - |
| review-comment | c20f1e2e-2e91-44fa-88fb-a6e8c5c97cac | comment | eea2745e2867a6772adc3e813211e6ce7b6ebd312d7e84a7c1b1aa2f8c75fd4b | short or technical; manual confirmation required | - | - |
| review-comment | c3d11722-254a-4405-a872-29feca735fc5 | comment | bfa7409f764695d313199f04b1fdad43a8cecff0f549997702e0352fbc92b3b2 | short or technical; manual confirmation required | - | - |
| review-comment | eea3d67a-a106-4a2b-996f-16ef4e017ae8 | comment | fc6fa7894a93729590e7d46e40e1a682a97062876cad148fbd181f1723dabba7 | short or technical; manual confirmation required | - | - |
| review-comment | f81155e3-ed68-41bd-a50f-5b9c36042f71 | comment | eeb78c7336516e237afb5d07538ba14d162246f2be6b353240bdd7912db05acd | short or technical; manual confirmation required | - | - |
| species | 25 | description | ab67e0c99ec308c5c13ea2fcfd191ec80b0d15b2fe522576d24f813121500133 | English-likely; manual confirmation required | - | - |
| species | 25 | habitat | 0febf48cb22e79f8316b7322150f720ecb97a8292cedb540fccc96a6babc3084 | English-likely; manual confirmation required | - | - |
| species | 26 | description | b860afc24c4996173bb3f02326b1c193abc4ad91d997044587290dabf0288424 | English-likely; manual confirmation required | - | - |
| species | 26 | habitat | 465aea2c776fefb90621a45968bf5031bbd8521745b4ec9ff0ae90f387ea5a58 | English-likely; manual confirmation required | - | - |
| species | 27 | description | 1b807775b4eda367c06f2ee3834c8d9601d1c3d0b3347a2dd6cad9232dc38bf1 | existing metadata en, matching hash | hash match | hash match |
| species | 27 | habitat | 96d4a4d6ca4bb27ba9a1a06e4470820323945e1f19d0868fdd9f21df4d4d956b | existing metadata en, matching hash | hash match | hash match |
| species | 28 | description | ceb8f0064d9fd06b66ce83801b67f39801e96d5dfba878ebccae34c295efe10e | English-likely; manual confirmation required | - | - |
| species | 28 | habitat | 9af88e864bd04b0ba2bf5356fcaf818fe3ada7dac391b915a1c5f5295b0f1c15 | uncertain; manual confirmation required | - | - |
| species | 29 | description | 2d20be713459c0681445eaab9dc21fd0a181f4be21b7e5b759cadd5c63a1f4a2 | English-likely; manual confirmation required | - | - |
| species | 29 | habitat | 51eb2d8b4613ecfec58d83e3be01730395585d3e0416db728a9a5c5da6364b66 | English-likely; manual confirmation required | - | - |
| species | 30 | description | 08e694542030f980f987b7c4a854d0006f5234ff737e4dd9dea4aed0d60d9fe1 | English-likely; manual confirmation required | - | - |
| species | 30 | habitat | a3bf0c4e5bec32efd003bb144aeac5cffc22c8ef710447485fd2b05e2ccad7de | uncertain; manual confirmation required | - | - |
| species | 31 | description | 418cc6cb967abe8989dbed6991a9883ddea85353c4c6a8c671e2b621d8876b7b | English-likely; manual confirmation required | - | - |
| species | 31 | habitat | 29c8b9747ad0672e3021eef0c752b5ab6390dfa04bf692a9e2546bdca87b7017 | English-likely; manual confirmation required | - | - |
| species | 32 | description | 0eef366d386f60ba1ed049209cac9e72df09da90cf35ceb62c26f5391fbb5cc4 | English-likely; manual confirmation required | - | - |
| species | 32 | habitat | 98faf2968ec615d87cc17f1f897c64b6ea8152c0c5c85bab7fdec33e43759f3a | English-likely; manual confirmation required | - | - |
| species | 33 | description | f76833325783fc05748ea1d5fdfe1c5aa73159059233604321fc02eb6c9b19d6 | English-likely; manual confirmation required | - | - |
| species | 33 | habitat | 6c7f757c48f91e2ca1c55a8e7c3f422fc41ffb2f149cc9839588000cd3721f42 | English-likely; manual confirmation required | - | - |

## New website species-record path

The website species form includes per-field language selectors for description, habitat, and cultural significance and submits those selections as `source_languages`. The Node create/edit handlers normalize the selections and persist metadata against the stored text hash in the same transaction. The focused regression/integration test exercises the new/edited English species text through the website translation API and cache path. The targeted backend tests passed (49/49). This is isolated-test evidence, not proof of a live browser or Ollama request.

## EACCES and live-test status

The restricted attempt failed at the PostgreSQL socket with `EACCES`. The approved elevated diagnostic connection using the configured application pool succeeded and verified the expected database, schema, and search path. This identifies the observed EACCES as an execution sandbox network restriction, rather than a database credential, certificate, or schema failure. Local HTTP services were not running during this audit; no live website/Ollama translation request was made.

## Approval boundary

No writes are authorized by this audit. Review and explicitly approve the exact candidate rows before any source-language metadata is inserted. Any changed text/hash or conflicting metadata must be skipped.
