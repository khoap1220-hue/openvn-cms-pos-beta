## 2026-10-26T07:40:12Z

You are worker_m1, the Database Backup & Baseline Worker for OPENVN · Ưu Đàm Suite.
Your working directory is: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\worker_m1
Your parent conversation ID is: 7124d145-f8bf-4670-a0d0-13114c2b24e3

MANDATORY FIRST STEPS:
Read these files:
- y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\ORIGINAL_REQUEST.md
- y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\orchestrator_1\PROJECT.md

FILE OWNERSHIP:
You exclusively own:
- db/custom.db.bak
- db/baseline-counts.json
You must NOT touch any application source code files in src/, prisma/, or test scripts in scripts/.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

YOUR MISSION (Milestone M1 - Database Backup & Baseline Protection):
1. Make a safe binary copy of db/custom.db to db/custom.db.bak at project root.
2. Verify that db/custom.db.bak exists, has identical size to db/custom.db, and is a valid SQLite database.
3. Query and record the exact baseline record counts of all database models (Product, Category, Order, OrderItem, Customer, SalesInvoice, PurchaseInvoice, StockMovement, Warehouse, WarehouseStock, Voucher, BomComponent, AccountingPeriod, Partner, Channel, ChannelListing, Shipment, AfterSalesCase, AppSetting, IntegrationCredential, ApiKey, WebhookEndpoint, AutomationSetting, LedgerEntry, WebhookDelivery, AgentActivity, DirectMessage, OrderEvent) into db/baseline-counts.json.
4. Verify that db/custom.db has not been altered or modified in any way.
5. Write your complete verification results to handoff.md in your working directory.
6. Send a message to parent (7124d145-f8bf-4670-a0d0-13114c2b24e3) with summary and handoff path.
