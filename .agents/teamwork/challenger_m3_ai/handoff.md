# Empirical Adversarial Challenge Handoff Report — Milestone 3 (M3: AI Planning & Copywriting)

## 1. Observation

### 1.1 Test Execution & Overall Results
- Executed `scripts/adversarial-m3-ai.ts` comprising 39 adversarial stress assertions across all 4 mandatory challenge dimensions and independent rubric evaluation.
- Pre-test and post-test database baseline audits against `db/baseline-counts.json` confirmed 100% parity across all 24 core tables (Delta = 0).
- Results summary:
  - Total checks: 39
  - Passed: 38
  - Failed (Vulnerability): 1

### 1.2 Verbatim Failure Output
```text
[CHALLENGE PHASE 1] Threads Boundary Stress Testing (Length Limits)
    Threads draft 1 length: 485 characters
  ✅ [PASS] Threads Draft 1: Tuân thủ nghiêm ngặt <= 500 ký tự khi tên sản phẩm dài
  ✅ [PASS] Threads Draft 1: Bảo toàn giá bán CRM sau khi cắt tỉa
  ✅ [PASS] Threads Draft 1: Bảo toàn tỷ lệ chiết khấu 20% sau khi cắt tỉa
    Sweeping 20 extreme variations of title and product lengths for Threads...
    ❌ Boundary breach at input len 175: output length = 506
    ❌ Boundary breach at input len 200: output length = 506
    ❌ Boundary breach at input len 225: output length = 506
    ❌ Boundary breach at input len 250: output length = 506
    ❌ Boundary breach at input len 275: output length = 506
    ❌ Boundary breach at input len 300: output length = 506
    ❌ Boundary breach at input len 325: output length = 506
    ❌ Boundary breach at input len 350: output length = 506
    ❌ Boundary breach at input len 375: output length = 506
    ❌ Boundary breach at input len 400: output length = 506
    Max observed Threads length across sweep: 506 chars
    Threads boundary violations count: 10/20
    ⚠️ Sample violation snippet: "... Mời mình nhắn tụi em nha 🌿 (350.000đ -15% mã UUDAM15THU)" (Length: 506)
  ❌ [FAIL] Threads Sweep: 0 vi phạm trên toàn bộ 20 biến thể độ dài cực hạn (Max: 506/500 chars) -> Phát hiện 10 trường hợp vượt quá 500 ký tự (Đạt đỉnh: 506 ký tự do off-by-six tại social-ai.ts:840)
```

### 1.3 Code Inspection & Root Cause
In `src/lib/social-ai.ts`, lines 837–844:
```typescript
  // Đảm bảo Threads không bao giờ vượt quá 500 ký tự sau khi enforce
  if (channel === 'THREADS' && content.length > 500) {
    // Cắt tỉa tinh tế giữ trọn vẹn giá trị CRM
    const crmTag = ` (${prodPrice}${discountPct ? ` -${discountPct}%` : ''} mã ${voucherCode || 'UUDAM'})`
    const maxTextLen = 500 - crmTag.length - 25
    const shortCore = content.slice(0, maxTextLen).replace(/[,\s]+$/, '')
    content = `${shortCore}... Mời mình nhắn tụi em nha 🌿${crmTag}`
  }
```
- The developer hardcoded `25` as the subtracted length for the suffix string.
- However, the actual string `"... Mời mình nhắn tụi em nha 🌿"` has a JavaScript UTF-16 character length of **31**:
  - `"... Mời mình nhắn tụi em nha "` = 29 chars
  - `"🌿"` (Unicode U+1F33F surrogate pair) = 2 chars
  - Total suffix length = 31 chars.
- When `content.length > 500` triggers truncation:
  `content.length = maxTextLen + suffix.length + crmTag.length = (500 - crmTag.length - 25) + 31 + crmTag.length = 506`.
- Result: **Every time truncation is triggered, the final output length is exactly 506 characters**, exceeding the platform hard limit of 500 characters.

### 1.4 Successful Invariants Observed
1. **Banned Phrases Sanitization (FEAT-AI-02)**:
   - 6 hostile inputs containing `"kính chào"`, `"quý khách"`, `"hân hạnh phục vụ"`, `"nguồn động lực quý báu"`, `"OmniSales"` were sanitized to 0 occurrences.
   - Posts generated across all 7 channels with hostile campaign descriptions contained 0 banned phrases.
2. **Hallucination Defense (FEAT-AI-03)**:
   - Hostile input with false price `10.000đ`, false voucher `FAKE_SUPER_DISCOUNT_99`, and fake discount `90%` was correctly flagged by `validateCrmInvariants`.
   - `enforceCrmInvariants` forced authentic CRM values (`320.000đ`, `25%`, `UUDAM_CHALLENGE_TRUE`).
3. **Campaign Time Boundary (FEAT-AI-01)**:
   - 1-day campaign (24h) with 7 posts: 100% scheduled strictly within `[startDate, endDate]`.
   - 60-day campaign with 14 posts: 100% scheduled strictly within `[startDate, endDate]` and monotonically increasing.
4. **Independent Agent Rubric Evaluation (R3 Acceptance Criteria / Caller Note 2026-10-26T14:32:56Z)**:
   - 10 real sample outputs across all 7 channels scored by independent challenger agent.
   - Evaluated criteria: Factuality (30%), Brand Voice (30%), Natural Language (20%), CTA/Formatting (20%).
   - Result: 10/10 passed with 10.0/10 score (threshold >= 8.0/10). Detailed scorecard saved in `independent-rubric-scores.json`.

---

## 2. Logic Chain

1. **Step 1 (Requirement Verification)**:
   - `ORIGINAL_REQUEST.md` (R3, AC) mandates: "Bài cho từng nền tảng không vượt giới hạn ký tự/định dạng của nền tảng đó" and specifically Threads <= 500 characters.
   - `orchestrator_2/PROJECT.md` (FEAT-PUB-07) specifies: "Publisher adapter for Threads with strict <= 500 character limit enforcement".
   - `src/lib/social-ai.ts` line 414 penalizes drafts with `content.length > 500` down to `fmtScore = 2.0`.
2. **Step 2 (Empirical Reproduction)**:
   - `scripts/adversarial-m3-ai.ts` ran a parameterized sweep varying campaign title and product lengths from 50 to 400 chars.
   - Whenever the initial text exceeded 500 characters, line 837 of `src/lib/social-ai.ts` executed truncation.
   - In 10 out of 20 test cases (lengths 175, 200, 225, 250, 275, 300, 325, 350, 375, 400), the returned `content.length` was 506 characters.
3. **Step 3 (Causal Mechanism)**:
   - The developer used a magic number `25` instead of computing `suffix.length` or using `31`.
   - `500 - 25 + 31 = 506`.
4. **Step 4 (Impact Assessment)**:
   - Threads API rejects payloads with length > 500 characters (HTTP 400).
   - In M5 publishing, any truncated Threads post will fail publication.
   - Therefore, the requirement is violated under extreme or long inputs.

---

## 3. Caveats

- Live social API endpoints were not invoked during testing, per strict Operational Safety Invariant (`FEAT-SEC-01` / `ALLOW_REAL_SOCIAL_PUBLISHING = false`).
- The 10 sample posts evaluated in the independent rubric were generated using the algorithmic hybrid fallback engine because external LLM quota was not consumed during local testing.

---

## 4. Conclusion

**Verdict: REJECT**

While M3 demonstrates exceptional engineering in Brand Voice sanitization, Deterministic CRM Invariant matching, time boundary distribution, and DB safety, the Threads post generator contains a deterministic off-by-six boundary defect (`content.length === 506 > 500`) at `src/lib/social-ai.ts:840`.

### Actionable Remediation for Worker M3:
In `src/lib/social-ai.ts`, replace lines 837–844:
```typescript
  // Đảm bảo Threads không bao giờ vượt quá 500 ký tự sau khi enforce
  if (channel === 'THREADS' && content.length > 500) {
    // Cắt tỉa tinh tế giữ trọn vẹn giá trị CRM
    const crmTag = ` (${prodPrice}${discountPct ? ` -${discountPct}%` : ''} mã ${voucherCode || 'UUDAM'})`
    const suffix = '... Mời mình nhắn tụi em nha 🌿'
    const maxTextLen = Math.max(0, 500 - crmTag.length - suffix.length)
    const shortCore = content.slice(0, maxTextLen).replace(/[,\s]+$/, '')
    content = `${shortCore}${suffix}${crmTag}`
  }
```
This guarantees `content.length <= 500` unconditionally under all input combinations.

---

## 5. Verification Method

1. Run the empirical adversarial stress suite:
   ```powershell
   npx tsx scripts/adversarial-m3-ai.ts
   ```
2. Verify the off-by-six failure in Phase 1:
   Observe failure log indicating `output length = 506` for lengths 175..400.
3. Verify baseline parity preservation:
   ```powershell
   node scripts/check-counts.mjs
   ```
   Confirm all 24 core business tables match `db/baseline-counts.json` with Delta = 0.
