# Local image remediation only; input hashes and output image ID are reviewed
# in image-lock.json. No application image or deployment registry is created.
FROM postgres:18.6-alpine3.24@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873
COPY su-exec.apk /tmp/su-exec.apk
COPY nghttp2-libs.apk /tmp/nghttp2-libs.apk
RUN apk add --no-network /tmp/su-exec.apk /tmp/nghttp2-libs.apk \
    && rm /tmp/su-exec.apk /tmp/nghttp2-libs.apk /usr/local/bin/gosu /var/log/apk.log \
    && test "$(grep -c 'exec gosu postgres' /usr/local/bin/docker-entrypoint.sh)" -eq 1 \
    && sed -i 's/exec gosu postgres/exec su-exec postgres/' /usr/local/bin/docker-entrypoint.sh \
    && su-exec postgres postgres --version
