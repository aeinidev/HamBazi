FROM nginx:1.30.5-alpine@sha256:8f84ed99befc3891b8f329c5c202785278a2cfb7c25107d57fb2a134a3117433
COPY inputs/*.apk /tmp/hambazi-patches/
RUN --network=none apk add --no-network /tmp/hambazi-patches/*.apk && rm -rf /tmp/hambazi-patches
ARG SOURCE_COMMIT
ARG BUILD_INPUT
LABEL org.opencontainers.image.revision=$SOURCE_COMMIT io.hambazi.component-input-sha256=$BUILD_INPUT io.hambazi.purpose=temporary-staging-component
USER 1000:1000
STOPSIGNAL SIGQUIT
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;", "-c", "/etc/hambazi/nginx.conf"]
