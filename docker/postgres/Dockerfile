FROM postgres:17-alpine

# Baked in rather than bind-mounted: a bind mount requires the checkout's path
# to be on Docker Desktop's file sharing list, which fails outright on a
# working copy kept outside the home directory (for example on another volume).
# The build context is copied, so this works wherever the repository lives.
COPY init.sql /docker-entrypoint-initdb.d/init.sql
