# Matrix Kịch Bản Đối Kháng (Adversarial Scenario Architect)
Dumped for challenger_m3_ai.

Core methodology:
1. Identify decisions, invariants, system boundaries, actors, inputs.
2. Invariants:
   - Threads character count: strict <= 500 characters.
   - Banned phrases: strictly 0 occurrences of corporate/robotic banlist ("kính chào", "quý khách", "hân hạnh phục vụ", "nguồn động lực quý báu").
   - Hallucination defense: CRM facts (price, voucher, product name, discount) are strictly enforced by Deterministic CRM Invariant Matcher over LLM hallucinations or hostile prompt injections.
   - Campaign time boundary: generated posts have scheduled dates strictly within [startDate, endDate].
   - DB baseline: 24 tables must have exactly 0 delta after adversarial runs and teardown.
