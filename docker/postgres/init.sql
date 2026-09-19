-- One database and one role per service. A service can reach only its own database,
-- so cross-service joins are impossible by grant, not by convention.

CREATE ROLE ipms_iam   WITH LOGIN PASSWORD 'ipms_iam';
CREATE ROLE ipms_audit WITH LOGIN PASSWORD 'ipms_audit';
CREATE ROLE ipms_project WITH LOGIN PASSWORD 'ipms_project';
CREATE ROLE ipms_qc WITH LOGIN PASSWORD 'ipms_qc';

CREATE DATABASE ipms_iam   OWNER ipms_iam;
CREATE DATABASE ipms_audit OWNER ipms_audit;
CREATE DATABASE ipms_project OWNER ipms_project;
CREATE DATABASE ipms_qc OWNER ipms_qc;

REVOKE ALL ON DATABASE ipms_iam   FROM PUBLIC;
REVOKE ALL ON DATABASE ipms_audit FROM PUBLIC;
REVOKE ALL ON DATABASE ipms_project FROM PUBLIC;
REVOKE ALL ON DATABASE ipms_qc FROM PUBLIC;

GRANT CONNECT ON DATABASE ipms_iam   TO ipms_iam;
GRANT CONNECT ON DATABASE ipms_audit TO ipms_audit;
GRANT CONNECT ON DATABASE ipms_project TO ipms_project;
GRANT CONNECT ON DATABASE ipms_qc TO ipms_qc;
