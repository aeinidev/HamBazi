ARG MIGRATION_PARENT=sha256:7a4446b7fce2dc624054b832d917e1d67f42894d49fb7f14d060157117e0a9dd
FROM ${MIGRATION_PARENT}
USER root
# Public migration inputs must be readable independently of the operator's umask.
COPY migration-input /run/hambazi/migration
RUN chown -R 0:0 /run/hambazi/migration \
    && find /run/hambazi/migration -type d -exec chmod 755 {} + \
    && find /run/hambazi/migration -type f -exec chmod 644 {} + \
    && chmod 755 /run/hambazi/migration/schema-engine
ENV PRISMA_SCHEMA_ENGINE_BINARY=/run/hambazi/migration/schema-engine
USER 1000:1000
