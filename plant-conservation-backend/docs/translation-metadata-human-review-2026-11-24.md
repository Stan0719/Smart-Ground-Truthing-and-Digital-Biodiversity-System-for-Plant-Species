# Human review: translation source-language metadata - 24 November 2026

## Read-only safety

Database identity was verified as `postgres`, schema `plant_app`, search path `plant_app, pg_catalog`. All queries ran inside a PostgreSQL READ ONLY transaction and were rolled back. No source record, metadata row, translation-cache row, or schema was changed. The text and hashes below were read from current stored source values; hashes use canonical SHA-256 over UTF-8 source text.

## Species 28 finding

Species ID **28** is included in the earlier 44-field missing-metadata count. Its current description and habitat both have no matching `species` metadata rows. The record is `Avicennia marina`, and it was created through species request **21**, which is approved and linked to species 28. The species and request were submitted on 22 November 2026 at 17:40 Malaysia time.

Git history shows the species-request language staging/promotion code was added on 23 November 2026 at 20:13 Malaysia time, after request 21 was created. The current path accepts selections on `POST /api/species-requests`, stages exact hashes under `__pending_species_request`, then promotes matching selections on approval. The existing request-approval tests cover staging and promotion. Request 21 has no remaining staged rows and species 28 has no final metadata, consistent with the request predating that feature. The old selection itself was not stored in a recoverable form, so we cannot establish what language was selected at submission time. This is a historical timing gap, not evidence that the current path drops selections.

| field | Current source text | Current SHA-256 | Metadata status |
|---|---|---|---|
| description | "Mangrove tree with leathery leaves, bark and breathing roots." | `ceb8f0064d9fd06b66ce83801b67f39801e96d5dfba878ebccae34c295efe10e` | missing |
| habitat | "Sheltered coastlines, tidal mud and mangrove habitats." | `9af88e864bd04b0ba2bf5356fcaf818fe3ada7dac391b915a1c5f5295b0f1c15` | missing |

The new species-request UI in the mobile app currently sends `source_languages`; the backend approval path promotes matching staged metadata. The website officer create/edit form also submits the per-field language map and stores its hashes transactionally. No code fix or new test is justified by species 28 because its creation predates the feature.

## Group A - English-likely candidates (not verified)

These **30** fields matched a lexical English heuristic. That is only triage. Proposed language is `en` for human review; do not insert metadata unless each original value is confirmed as English. A matching hash must be recalculated immediately before any later approved write.

### observation 139c19a6-a967-498a-9399-8b638da2744a - `morphology`

- Original text: "Woody stem with developing crown and dense green foliage"
- Current SHA-256: `8af6a0b180373c8246d4276c1728704dcfe1bf6d370c98d08984c291b682c167`
- Proposed source language: en (proposed; human confirmation required)

### observation 17e4efa2-5708-413c-b7a0-e2cf16ec4485 - `morphology`

- Original text: "Woody tree with upright trunk, oval leaves and developing crown."
- Current SHA-256: `e37ecd40eab4c6faac5e4608ea05545dea81b22305a39efde1541ed1fe69b0af`
- Proposed source language: en (proposed; human confirmation required)

### observation 18e9bfb5-f2ae-4990-bffc-6b8a137d418d - `morphology`

- Original text: "Young tree with oval leaves and upright stem"
- Current SHA-256: `e283e49a4bff5dcb07cc00e5ef01aa05a43a0d217d2888d9469e56872749d905`
- Proposed source language: en (proposed; human confirmation required)

### observation 23bfd755-fc56-4f9c-9e33-8582cfac665c - `morphology`

- Original text: "Young tree with upright stem and oval green leaves."
- Current SHA-256: `e247b4b707934a1ef294530d7c06e9d0333a091284ad9ed83b1e8b1ea02143e0`
- Proposed source language: en (proposed; human confirmation required)

### observation 275b6d51-d62d-4b89-815a-7f0a1740564f - `morphology`

- Original text: "Climbing vine with green-red pitchers"
- Current SHA-256: `61462e84d4522416aa530feb5abac877356579ef11729771b478818dcb8c9583`
- Proposed source language: en (proposed; human confirmation required)

### observation 51741d0f-6f09-44d4-a31c-c557bb9b2177 - `morphology`

- Original text: "Mangrove with grey-green foliage, branching stems and a few breathing roots"
- Current SHA-256: `5635824ecc35b829f88a073f95f477e861ef2e0a58565128109dc5a2e11a7764`
- Proposed source language: en (proposed; human confirmation required)

### observation 64c118c9-07d6-46d0-934f-5d053241bd43 - `morphology`

- Original text: "Mangrove with branching stems and leathery leaves."
- Current SHA-256: `7326a3a6989b84c5e7f720af37ffb097d8e2df3841caceb39d2dc8281edd4a81`
- Proposed source language: en (proposed; human confirmation required)

### observation 72183b6e-15d3-4be9-9a55-fc9bb3a0d412 - `morphology`

- Original text: "Large tree with thick trunk, elevated canopy and extensive branches."
- Current SHA-256: `0f87824b439aabe6913abc8e02223bbd2293f0afe11ef9e4c32081a9e69a918b`
- Proposed source language: en (proposed; human confirmation required)

### observation 99aa7f59-469f-466b-b037-8e76d3eabda5 - `morphology`

- Original text: "Broad crown, thick branches and cone-shaped breathing roots"
- Current SHA-256: `13c87e5b71a7a64091096e234d29ff1705179e648eae975a3962a7fb8a578c9c`
- Proposed source language: en (proposed; human confirmation required)

### observation a9f86bbd-e427-4356-8a27-8f2eb216a641 - `morphology`

- Original text: "Young mangrove with small leathery leaves and upright stem."
- Current SHA-256: `4d6f1493e388eb641f9135e159e1bd585c488ded0b3f4997c402b120c4496780`
- Proposed source language: en (proposed; human confirmation required)

### observation b289fb01-ba28-4d91-b054-0d30d4fdab7f - `morphology`

- Original text: "Straight young stem with several broad green leaves."
- Current SHA-256: `a294c63a121e8936381671bec106a2a7f39c1d72db1fba0cd799904e656c6ea0`
- Proposed source language: en (proposed; human confirmation required)

### observation b2b978ae-a92e-4bd0-b8af-5912f4725792 - `morphology`

- Original text: "Small fern with compact rosette of narrow green fronds."
- Current SHA-256: `4c343edd7a108d35ff01337480c71450e35e445b9652f434b7d2438e7ebb140e`
- Proposed source language: en (proposed; human confirmation required)

### observation b4451618-300b-42bc-bc08-cad6e716ce5e - `morphology`

- Original text: "Broad green leaves with yellow flowers"
- Current SHA-256: `16f9d0ca13ea4d4a198741967bf8d1850952247ab68c2376f3da635fdb008a23`
- Proposed source language: en (proposed; human confirmation required)

### observation b9b3a9ec-9ff9-4482-8733-92b642d67284 - `morphology`

- Original text: "Broad green leaves with yellow flowers"
- Current SHA-256: `16f9d0ca13ea4d4a198741967bf8d1850952247ab68c2376f3da635fdb008a23`
- Proposed source language: en (proposed; human confirmation required)

### observation bacb0c89-e50d-402f-83ce-eb485f0a6a05 - `morphology`

- Original text: "Climbing plant with elongated leaves and several green pitchers with reddish markings."
- Current SHA-256: `85743b4608efc33ca3a8ae479dde814a9824500c8aa49388e2bb4b1769095384`
- Proposed source language: en (proposed; human confirmation required)

### observation f77eae42-e240-49db-b6c2-b13e66d7e390 - `morphology`

- Original text: "Large green fronds forming a broad rosette"
- Current SHA-256: `1d6c8dad47519275ec7ca09b00d771b403819a3cb01ee2c5c5c7704d6a0fed25`
- Proposed source language: en (proposed; human confirmation required)

### species 25 - `description`

- Original text: "Large tropical forest tree with broad canopy and dipterocarp foliage."
- Current SHA-256: `ab67e0c99ec308c5c13ea2fcfd191ec80b0d15b2fe522576d24f813121500133`
- Proposed source language: en (proposed; human confirmation required)

### species 25 - `habitat`

- Original text: "Mixed dipterocarp forest; moist slopes and river-associated areas."
- Current SHA-256: `0febf48cb22e79f8316b7322150f720ecb97a8292cedb540fccc96a6babc3084`
- Proposed source language: en (proposed; human confirmation required)

### species 26 - `description`

- Original text: "Very large tropical tree with tall trunk and large canopy."
- Current SHA-256: `b860afc24c4996173bb3f02326b1c193abc4ad91d997044587290dabf0288424`
- Proposed source language: en (proposed; human confirmation required)

### species 26 - `habitat`

- Original text: "Mixed dipterocarp forest, generally on well-drained soils."
- Current SHA-256: `465aea2c776fefb90621a45968bf5031bbd8521745b4ec9ff0ae90f387ea5a58`
- Proposed source language: en (proposed; human confirmation required)

### species 28 - `description`

- Original text: "Mangrove tree with leathery leaves, bark and breathing roots."
- Current SHA-256: `ceb8f0064d9fd06b66ce83801b67f39801e96d5dfba878ebccae34c295efe10e`
- Proposed source language: en (proposed; human confirmation required)

### species 29 - `description`

- Original text: "Tropical tree known for fragrant resinous agarwood formation in some individuals."
- Current SHA-256: `2d20be713459c0681445eaab9dc21fd0a181f4be21b7e5b759cadd5c63a1f4a2`
- Proposed source language: en (proposed; human confirmation required)

### species 29 - `habitat`

- Original text: "Lowland and hill tropical forests."
- Current SHA-256: `51eb2d8b4613ecfec58d83e3be01730395585d3e0416db728a9a5c5da6364b66`
- Proposed source language: en (proposed; human confirmation required)

### species 30 - `description`

- Original text: "Mangrove tree with spreading canopy, flowers and round fruits."
- Current SHA-256: `08e694542030f980f987b7c4a854d0006f5234ff737e4dd9dea4aed0d60d9fe1`
- Proposed source language: en (proposed; human confirmation required)

### species 31 - `description`

- Original text: "Carnivorous climbing plant with leaves ending in tendrils and pitcher-shaped traps."
- Current SHA-256: `418cc6cb967abe8989dbed6991a9883ddea85353c4c6a8c671e2b621d8876b7b`
- Proposed source language: en (proposed; human confirmation required)

### species 31 - `habitat`

- Original text: "Forest margins, kerangas, peat swamp and nutrient-poor tropical habitats."
- Current SHA-256: `29c8b9747ad0672e3021eef0c752b5ab6390dfa04bf692a9e2546bdca87b7017`
- Proposed source language: en (proposed; human confirmation required)

### species 32 - `description`

- Original text: "Epiphytic fern with broad fronds forming a nest-like rosette."
- Current SHA-256: `0eef366d386f60ba1ed049209cac9e72df09da90cf35ceb62c26f5391fbb5cc4`
- Proposed source language: en (proposed; human confirmation required)

### species 32 - `habitat`

- Original text: "Shaded humid forests; grows on trunks, branches, rocks or ground."
- Current SHA-256: `98faf2968ec615d87cc17f1f897c64b6ea8152c0c5c85bab7fdec33e43759f3a`
- Proposed source language: en (proposed; human confirmation required)

### species 33 - `description`

- Original text: "Shrub with large green leaves and bright yellow flowers"
- Current SHA-256: `f76833325783fc05748ea1d5fdfe1c5aa73159059233604321fc02eb6c9b19d6`
- Proposed source language: en (proposed; human confirmation required)

### species 33 - `habitat`

- Original text: "Tropical forests, wetlands, and open areas in Sarawak"
- Current SHA-256: `6c7f757c48f91e2ca1c55a8e7c3f422fc41ffb2f149cc9839588000cd3721f42`
- Proposed source language: en (proposed; human confirmation required)


## Group B - uncertain, mixed, short, or technical (no proposed language)

These **14** fields are not suitable for automatic source-language assignment. They remain unmodified and should only be considered after an individual human language review.

### observation b4451618-300b-42bc-bc08-cad6e716ce5e - `notes`

- Original text: "All Good"
- Current SHA-256: `9242b7c1c2264ac9ea066e03d151b71fb6e2053e666d95e5c81edaf6dd432461`
- Proposed source language: none - review individually

### review-comment 3ad33fbd-933a-41c2-a0e0-1900a0f26eba - `comment`

- Original text: "verified"
- Current SHA-256: `1c34f88707b55e6104c4eb20e71ffa3d33e414b71ef689a15fad0640d0ac58cb`
- Proposed source language: none - review individually

### review-comment 47141623-ee44-4e88-9347-3694ca515110 - `comment`

- Original text: "verified"
- Current SHA-256: `1c34f88707b55e6104c4eb20e71ffa3d33e414b71ef689a15fad0640d0ac58cb`
- Proposed source language: none - review individually

### review-comment 6a6e0cba-8c78-4081-a6e6-1fa8c50392f8 - `comment`

- Original text: "Verified."
- Current SHA-256: `bfa7409f764695d313199f04b1fdad43a8cecff0f549997702e0352fbc92b3b2`
- Proposed source language: none - review individually

### review-comment 703ed3eb-f054-45b3-b847-be6c88ca8ec9 - `comment`

- Original text: "Verified."
- Current SHA-256: `bfa7409f764695d313199f04b1fdad43a8cecff0f549997702e0352fbc92b3b2`
- Proposed source language: none - review individually

### review-comment 733bcf75-37f6-461e-b33d-43ab07adc5ab - `comment`

- Original text: "verified"
- Current SHA-256: `1c34f88707b55e6104c4eb20e71ffa3d33e414b71ef689a15fad0640d0ac58cb`
- Proposed source language: none - review individually

### review-comment 7eccd482-b57f-4efa-be0f-abad99615de8 - `comment`

- Original text: "request correction for Zone"
- Current SHA-256: `6e7b7d464a646d13f531081af61f2f76e3c019d099534af7db40df5d06bbbad2`
- Proposed source language: none - review individually

### review-comment 97ce2510-8f5b-4044-a065-cb6238247924 - `comment`

- Original text: "Verified."
- Current SHA-256: `bfa7409f764695d313199f04b1fdad43a8cecff0f549997702e0352fbc92b3b2`
- Proposed source language: none - review individually

### review-comment c20f1e2e-2e91-44fa-88fb-a6e8c5c97cac - `comment`

- Original text: "Verify"
- Current SHA-256: `eea2745e2867a6772adc3e813211e6ce7b6ebd312d7e84a7c1b1aa2f8c75fd4b`
- Proposed source language: none - review individually

### review-comment c3d11722-254a-4405-a872-29feca735fc5 - `comment`

- Original text: "Verified."
- Current SHA-256: `bfa7409f764695d313199f04b1fdad43a8cecff0f549997702e0352fbc92b3b2`
- Proposed source language: none - review individually

### review-comment eea3d67a-a106-4a2b-996f-16ef4e017ae8 - `comment`

- Original text: "Good !!"
- Current SHA-256: `fc6fa7894a93729590e7d46e40e1a682a97062876cad148fbd181f1723dabba7`
- Proposed source language: none - review individually

### review-comment f81155e3-ed68-41bd-a50f-5b9c36042f71 - `comment`

- Original text: "wrong zone. Rejected."
- Current SHA-256: `eeb78c7336516e237afb5d07538ba14d162246f2be6b353240bdd7912db05acd`
- Proposed source language: none - review individually

### species 28 - `habitat`

- Original text: "Sheltered coastlines, tidal mud and mangrove habitats."
- Current SHA-256: `9af88e864bd04b0ba2bf5356fcaf818fe3ada7dac391b915a1c5f5295b0f1c15`
- Proposed source language: none - review individually

### species 30 - `habitat`

- Original text: "Tidal mangrove areas and newly deposited muddy substrates."
- Current SHA-256: `a3bf0c4e5bec32efd003bb144aeac5cffc22c8ef710447485fd2b05e2ccad7de`
- Proposed source language: none - review individually


## Existing confirmed entries

Species 27 `description` and `habitat` already have explicit `en` metadata whose hashes match current source text. They are not included in the proposed inserts.

## Approval boundary

No proposed entries have been written. To proceed later, approve the specific Group A rows (and any individually reviewed Group B rows) by record type, ID, field, and source hash. A write must skip any row whose current text/hash or metadata differs from this inventory.
