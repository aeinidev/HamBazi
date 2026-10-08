FROM certbot/certbot:v5.8.0@sha256:398c47284a6d6782825be71685f677ef3a1e65b8b5c278a8b1e99f6da84b4eb9
COPY inputs/ /tmp/hambazi-patches/
RUN --network=none apk add --no-network /tmp/hambazi-patches/*.apk && \
    uv pip install --system --offline --no-deps /tmp/hambazi-patches/*.whl && \
    rm -rf /tmp/hambazi-patches && rm -f /usr/local/bin/uv /usr/local/bin/uvx
ARG SOURCE_COMMIT
ARG BUILD_INPUT
LABEL org.opencontainers.image.revision=$SOURCE_COMMIT io.hambazi.component-input-sha256=$BUILD_INPUT io.hambazi.purpose=temporary-staging-component
ENTRYPOINT ["certbot"]
