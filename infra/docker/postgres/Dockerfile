# Local image remediation only; input hashes and output image ID are reviewed
# in image-lock.json. No application image or deployment registry is created.
FROM postgres:18.6-alpine3.24@sha256:3b0ef735388b2cb097fc29b8bb421d86d57d0ddbe7aa1fbd6493e06d65028503
COPY *.apk /tmp/hambazi-apk/
RUN apk add --no-network /tmp/hambazi-apk/*.apk \
    && rm -rf /tmp/hambazi-apk /usr/local/bin/gosu /var/log/apk.log \
    && test "$(grep -c 'exec gosu postgres' /usr/local/bin/docker-entrypoint.sh)" -eq 1 \
    && sed -i 's/exec gosu postgres/exec su-exec postgres/' /usr/local/bin/docker-entrypoint.sh \
    && su-exec postgres postgres --version
