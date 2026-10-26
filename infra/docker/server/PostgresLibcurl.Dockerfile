# Candidate only: preserve the exact installed PostgreSQL runtime and patch one signed APK.
FROM sha256:646e47d029792855c984a6c1123a97843ee7456e0df5579683b99cba111641aa
COPY libcurl-8.23.0-r0.apk /tmp/libcurl-8.23.0-r0.apk
RUN printf '%s\n' '1f70ca404818805a6465b615bbfe84ef861488a963d7e630108ebd7fbaa51665  /tmp/libcurl-8.23.0-r0.apk' | sha256sum -c - \
    && apk add --no-network --no-logfile /tmp/libcurl-8.23.0-r0.apk \
    && rm /tmp/libcurl-8.23.0-r0.apk \
    && test "$(postgres --version)" = 'postgres (PostgreSQL) 18.6'
