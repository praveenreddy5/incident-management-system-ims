# Incident Management System (IMS)

Production-oriented incident response platform for high-throughput infrastructure signals.
It combines async ingestion, debounced incident creation, strict workflow governance, and RCA-enforced closure with a live operational dashboard.

## 📦 Repository Structure

```text
📦 incident-management-system/
├── 🗂️ backend/
│   ├── 📂 src/
│   ├── 🧪 tests/
│   ├── 🗄️ prisma/
│   ├── 🐳 Dockerfile
│   ├── 📦 package.json
│   └── ⚙️ tsconfig.json
│
├── 🗂️ frontend/
│   ├── 📂 src/
│   ├── 🌐 public/
│   ├── 🐳 Dockerfile
│   ├── 📦 package.json
│   └── ⚡ vite.config.ts
│
├── 🏗️ infra/
│   ├── 🐳 docker-compose.yml
│   
│
├── 🧪 scripts/
│   ├── 🚀 load-test-signals.mjs
│   ├── ⚠️ simulate-failure.mjs
│   └── 📄 sample-failure-events.json
│  
│
├── 📘 README.md
└── 🚫 .gitignore
```

## Architecture Diagram
```text

                   🟦 SIGNAL INGESTION LAYER
        ┌──────────────────────────────────────────┐
        │          Signal Producers (APIs, DB, MQ) │
        └──────────────────────┬───────────────────┘
                               │
                               ▼
        ┌──────────────────────────────────────────┐
                 POST /signals API                 
              ⚡ Rate Limiting + Validation        
        └──────────────────────┬───────────────────┘
                               │
                               ▼
        ┌──────────────────────────────────────────┐
                 BullMQ Ingestion Queue            
             🧵 Async buffering (Backpressure)    
        └──────────────────────┬───────────────────┘
                               │
                               ▼
        ┌──────────────────────────────────────────┐
                   Signal Worker                   
             🔁 Retry Logic + Dead Letter Queue   
        └───────────────┬───────────────┬─────────┘
                        │               │
        🟨 PROCESSING LAYER       🟨 STORAGE LAYER
                 │                       │
                 │                       │
                 ▼                       ▼
┌────────────────────────────┐   ┌──────────────────────────────┐
  Debounce Service (Redis)          Raw Signals (MongoDB)        
  ⏱ 10s window                    📜 Append-only audit logs     
 1 Work Item / Component          High-volume ingestion store   
└──────────────┬────────────┘   └──────────────┬───────────────┘
               │                               │
               ▼                               ▼
      ┌──────────────────────────────┐   ┌────────────────────────────┐
      │ Work Items + RCA             │   │ Time-series Aggregation     
      │ 🧾 Postgres (Source of Truth)│   │ 📊 Signals per minute       
      │ Prisma ORM (transactions)    │   │ Dashboard analytics         
      └──────────────┬───────────────┘   └──────────────┬─────────────┘
                     │                                  │
                     └──────────────┬───────────────────┘
                                    ▼
                    🟩 REAL-TIME ACCESS LAYER
        ┌──────────────────────────────────────────┐
        │         Redis Cache (Hot Path)           
        │ ⚡ Active Incidents (Fast UI reads)      
        └──────────────────────┬───────────────────┘
                               │
                               ▼
                    🟪 PRESENTATION LAYER
        ┌──────────────────────────────────────────┐
        │        React Dashboard UI                 
        │  📡 Live Feed | 🔍 Detail | 📝 RCA Form  
        └──────────────────────────────────────────┘
```

## Tech Stack
| Layer | Technology |
|---|---|
| API / Worker Runtime | Node.js, TypeScript, Express |
| Queue & Job Processing | BullMQ |
| Source of Truth | PostgreSQL, Prisma |
| Raw Signal Lake | MongoDB, Mongoose |
| Cache / Debounce / Rate Limit | Redis |
| Frontend | React, Vite, TypeScript |
| Testing | Vitest |
| Containerization | Docker, Docker Compose |

## ⚡ System Design Highlights
⚡ Async processing: Ingestion API responds immediately; heavy processing (persistence, correlation, enrichment) is handled asynchronously by workers to ensure non-blocking throughput.

🧠 Debouncing strategy: A 10-second component-level window merges high-frequency bursts into a single Work Item while incrementally updating signalCount in real time.

🔁 Workflow state machine: Strict and controlled lifecycle transitions enforced:
OPEN → INVESTIGATING → RESOLVED → CLOSED
(prevents invalid or skipping states)

🧾 RCA enforcement rule: System enforces governance — incidents cannot transition to CLOSED unless a complete and valid RCA payload is submitted.

⏱ MTTR calculation: Automatically computed using first signal timestamp → RCA submission timestamp, ensuring accurate operational recovery tracking.

## 🧯 Backpressure Handling
⚡ Rate limiting at ingestion layer: Protects the system from traffic spikes by throttling incoming requests before they reach the queue and storage layers.

📬 Queue-based decoupling (BullMQ): Buffers high-volume signal bursts, ensuring downstream systems (DBs, workers) are not overwhelmed.

🔁 Retry strategy with exponential handling: Transient failures in MongoDB or PostgreSQL writes are retried safely without data loss.

🧯 Dead Letter Queue (DLQ): Persistent or repeated failures are isolated to prevent worker blocking and system slowdown.

⚡ Redis hot cache layer: Serves frequently accessed active incident data directly from memory, significantly reducing database read pressure.


## Setup Instructions

### Docker (recommended)

```bash
docker compose -f infra/docker-compose.yml up --build
```


### Local backend

```bash
cd backend
npm install
npx prisma migrate deploy
npm run dev
```

### Local frontend

```bash
cd frontend
npm install
npm run dev
```

## Scripts

- **Load testing**: `node scripts/load-test-signals.mjs`
- **Failure simulation**: `node scripts/simulate-failure.mjs`
- **Sample event payloads**: `scripts/sample-failure-events.json`



## Observability

-  **Health endpoint**: `GET /health` (service readiness/degraded state).
- **Throughput telemetry**: logs every 5 seconds (`signals/sec`, queue size, active incidents, retries, error rate, latency percentiles).

---


