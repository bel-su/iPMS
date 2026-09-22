# Environment Files per Service

This directory contains individual environment files for each microservice and its dedicated database:

| Service / Database | Environment File | Default Port | Description |
| :--- | :--- | :--- | :--- |
| **IAM Database** | `iam-db.env` | 5433 (mapped to 5432) | PostgreSQL credentials for IAM database (`ipms_iam`) |
| **IAM Service** | `iam.env` | 3001 | Identity and Access Management service + migrations |
| **Audit Database** | `audit-db.env` | 5434 (mapped to 5432) | PostgreSQL credentials for Audit database (`ipms_audit`) |
| **Audit Service** | `audit.env` | 3003 | Tamper-evident Audit logging service + migrations |
| **Project Database** | `project-db.env` | 5435 (mapped to 5432) | PostgreSQL credentials for Project database (`ipms_project`) |
| **Project Service** | `project.env` | 3004 | Projects, sites, and tasks management service + migrations |
| **QC Database** | `qc-db.env` | 5436 (mapped to 5432) | PostgreSQL credentials for Quality Control database (`ipms_qc`) |
| **QC Service** | `qc.env` | 3005 | Quality Control inspections and checklists service + migrations |
| **API Gateway** | `gateway.env` | 3000 | Reverse proxy, authentication verification, rate limiter |
| **Web Frontend** | `web.env` | 3100 | Next.js portfolio dashboard web application |
