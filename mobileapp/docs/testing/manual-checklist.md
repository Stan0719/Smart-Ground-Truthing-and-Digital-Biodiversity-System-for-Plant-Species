# Mobile manual and device checklist

**Status for all rows:** NOT EXECUTED. Use a nonproduction isolated account and backend. Record actual result, date, device/OS, locale, screenshots and defect ID at execution time. Never place tokens, GPS of protected species or personal data in evidence.

| ID | Preconditions and test data | Tester steps | Expected | Actual / evidence |
|---|---|---|---|---|
| MAN-01 | Guest phone, approved public records | Open Plant/Species catalogues; search, filter, scroll to end | Correct cards, empty/loading/error states; no unpublished data | Pending |
| MAN-02 | Visitor test account | Favourite/unfavourite, scan QR and reopen history | Own favourites/history persist; no other account data | Pending |
| MAN-03 | Botanist test account | Login, logout, revisit dashboard | Correct route and counts; session expiry handled | Pending |
| MAN-04 | Isolated approved Species and QR | Add Plant with GPS/photos, save/reopen draft, submit | Data preserved; correct pending status | Pending |
| MAN-05 | Isolated pending/approved/rejected records | Open details, edits, corrections and history | Correct original/proposed values, dates and statuses | Pending |
| MAN-06 | Isolated approved Plant | Add Observation, enter height/GPS/photo, submit and revisit | Observation belongs to selected Plant; registration unchanged | Pending |
| MAN-07 | Printed fixture QR codes | Scan assigned/unassigned and status variants | Correct role-specific alerts; scanner remains usable | Pending |
| MAN-08 | Test notifications | Open, navigate and mark read | Correct recipient/navigation/read state | Pending |
| MAN-09 | Small iPhone, large iPhone, Android | Open long forms/modals and keyboard, scroll inner lists, tap buttons | No clipping; all controls reachable | Pending |
| MAN-10 | EN/MS/ZH, 100% and 200%, system large text | Switch language and text size on catalogues, forms, bottom nav | Readable labels, buttons, cards and screen reader output | Pending |
| MAN-11 | Backend intentionally unavailable in isolated environment | Open lists and retry after restart | Useful error; existing drafts/data retained; loading ends | Pending |
