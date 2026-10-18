FROM hambazi-staging/ingress:d6eb25b049d251bd6e2f82bf428396b37486b6fa-f59e015968b3b4f9@sha256:d82fb564f36c55dce03ceb11c7329882b2588a3508058746c8e1aa8b4ae6bbcb
USER root
COPY inputs/*.apk /tmp/hambazi-patches/
RUN --network=none apk add --no-network /tmp/hambazi-patches/*.apk && rm -rf /tmp/hambazi-patches
ARG SOURCE_COMMIT
ARG BUILD_INPUT
LABEL org.opencontainers.image.revision=$SOURCE_COMMIT io.hambazi.component-input-sha256=$BUILD_INPUT io.hambazi.purpose=temporary-staging-component
USER 1000:1000
STOPSIGNAL SIGQUIT
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;", "-c", "/etc/hambazi/nginx.conf"]
