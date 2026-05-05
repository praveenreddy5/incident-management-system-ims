# 🐳 Running IMS with Docker (Recommended)

This is the recommended way to run the Incident Management System (IMS).  
Docker ensures all services (frontend, backend, databases, cache) run in a consistent and isolated environment.

---

## 🚀 Start the Full Stack

Run the following command from the project root:

```bash
docker compose -f infra/docker-compose.yml up --build
```

### What this does:
- Builds backend and frontend images  
- Starts PostgreSQL, MongoDB, and Redis  
- Connects all services in a shared network  
- Starts the IMS application end-to-end  

---

## ⚡ Run in Background (Optional)

To run services in detached mode:

```bash
docker compose -f infra/docker-compose.yml up --build -d
```

This allows the system to run in the background without blocking your terminal.

---

## 🌐 Access the Application

Once all containers are running, open:

- **Frontend:** http://localhost:5173  
- **Backend API:** http://localhost:3000  
- **Health Check:** http://localhost:3000/health  

---

## 🛑 Stop the System

To stop all running services:

```bash
docker compose -f infra/docker-compose.yml down
```

---

## 🧹 Clean Reset (Remove Data + Volumes)

⚠️ This will delete database and cached data.

```bash
docker compose -f infra/docker-compose.yml down -v
```

---

## ⚠️ Important Notes

### First-time startup may take time
- Docker will pull base images (Node, PostgreSQL, Redis, MongoDB)  
- Initial build may take several minutes  

---

### Port Conflicts

Default ports used:

- Frontend → **5173**  
- Backend → **3000**  
- PostgreSQL → **5432**  
- MongoDB → **27017**  
- Redis → **6379**  

If a port is already in use, Docker may fail to start services.

---

### Data Persistence

- PostgreSQL and MongoDB data are stored in Docker volumes  
- Data remains even after container restart (unless `-v` is used)  

---

## 🧠 Recommended Usage

Use Docker when:

- Running full system end-to-end  
- Testing integrations between services  
- Demonstrating the project  
- Avoiding local dependency setup  

---

## 🟢 Summary

Docker provides a **fully isolated, production-like environment** that makes IMS:

- Easy to run  
- Easy to evaluate  
- Consistent across all machines  
