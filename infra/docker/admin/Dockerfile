ARG APPROVED_RUNTIME_IMAGE
FROM ${APPROVED_RUNTIME_IMAGE}
USER root
# The approved runtime supplies Node/OS libraries only. Replace its complete application tree.
RUN rm -rf /app && mkdir /app
COPY api/ /app/
COPY client/ /opt/hambazi/admin-client/
COPY healthcheck.mjs /app/admin-healthcheck.mjs
WORKDIR /app
ENV NODE_ENV=production
ARG ADMIN_SOURCE_SHA256
LABEL io.hambazi.component=admin \
      io.hambazi.admin-source-sha256=$ADMIN_SOURCE_SHA256
USER 1000:1000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=20s --timeout=8s --start-period=30s --retries=3 CMD ["node", "admin-healthcheck.mjs"]
ENTRYPOINT ["node", "--disable-warning=ExperimentalWarning"]
CMD ["dist/composition/admin-main.js"]
